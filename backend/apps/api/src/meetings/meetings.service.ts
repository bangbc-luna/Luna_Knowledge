import { type AuditRecord, type Meeting, type Prisma, writeAudit } from '@luna/db';
import { enqueueMeetingReminder, type JobQueue, QUEUES } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { decodeKeysetCursor, encodeKeysetCursor, type Page } from '../common/pagination/cursor.js';
import { ContentAccessService } from '../content/content-access.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UsersService } from '../users/users.service.js';
import { MeetingAccess } from './meeting-access.service.js';
import type {
  CreateMeetingBody,
  InviteBody,
  ListMeetingsQuery,
  UpdateMeetingBody,
} from './meetings.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const ENDED_MESSAGE = 'This meeting has already ended';

type MeetingRow = Meeting & {
  createdBy: { id: string; email: string; name: string; avatarUrl: string | null };
};

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentAccessService,
    private readonly access: MeetingAccess,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUES.MEETINGS) private readonly queue: JobQueue<'meetings'>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async scheduleReminder(meetingId: string, scheduledAt: Date | null) {
    if (!scheduledAt) return;
    try {
      await enqueueMeetingReminder(
        this.queue,
        meetingId,
        scheduledAt,
        this.config.MEETING_REMINDER_MINUTES,
      );
    } catch (err) {
      this.logger.warn({ err, meetingId }, 'Could not enqueue meeting reminder');
    }
  }

  async create(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateMeetingBody,
    ctx: RequestContext,
  ) {
    await this.content.requireMember(user, workspaceId, 'MEMBER');
    const invitees = await this.resolveInvitees(user, body.inviteeEmails);
    const scheduledAt = body.mode === 'instant' ? new Date() : body.scheduledAt!;
    const meeting = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.meeting.create({
        data: {
          workspaceId,
          title: body.title,
          scheduledAt,
          aiNotesEnabled: body.aiNotesEnabled,
          createdById: user.id,
          invites: {
            create: invitees.map((u) => ({ userId: u.id, invitedById: user.id })),
          },
        },
        include: { createdBy: { select: userSummary } },
      });
      await this.auditTx(tx, ctx, {
        actorId: user.id,
        action: 'meeting.create',
        targetType: 'meeting',
        targetId: created.id,
        workspaceId,
        metadata: {
          title: created.title,
          mode: body.mode,
          scheduledAt: scheduledAt.toISOString(),
          aiNotesEnabled: created.aiNotesEnabled,
          inviteeCount: invitees.length,
        },
      });
      return created;
    });
    await this.notifyInvited(user, meeting, invitees);
    if (body.mode !== 'instant') await this.scheduleReminder(meeting.id, meeting.scheduledAt);
    return this.toDto(meeting, 0);
  }

  async list(
    user: AuthenticatedUser,
    workspaceId: string,
    q: ListMeetingsQuery,
  ): Promise<Page<ReturnType<MeetingsService['toDto']>>> {
    await this.content.requireMember(user, workspaceId);
    const config = {
      upcoming: { status: 'SCHEDULED', field: 'scheduledAt', dir: 'asc' },
      live: { status: 'LIVE', field: 'startedAt', dir: 'desc' },
      past: { status: 'ENDED', field: 'endedAt', dir: 'desc' },
    } as const;
    const { status, field, dir } = config[q.scope];
    const cmp = dir === 'asc' ? 'gt' : 'lt';
    const cursor = q.cursor ? decodeKeysetCursor(q.cursor) : null;
    const where: Prisma.MeetingWhereInput = {
      workspaceId,
      status,
      ...(cursor
        ? {
            OR: [
              { [field]: { [cmp]: cursor.at } },
              { [field]: cursor.at, id: { [cmp]: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.client.meeting.findMany({
      where,
      orderBy: [{ [field]: dir }, { id: dir }],
      take: q.limit + 1,
      include: { createdBy: { select: userSummary } },
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const counts = await this.attendeeCounts(items.map((m) => m.id));
    const last = items[items.length - 1];
    const lastAt = last?.[field];
    return {
      items: items.map((m) => this.toDto(m, counts.get(m.id) ?? 0)),
      nextCursor: hasMore && last && lastAt ? encodeKeysetCursor(lastAt, last.id) : null,
    };
  }

  async get(user: AuthenticatedUser, meetingId: string) {
    const { isHost, canManage } = await this.access.require(user, meetingId);
    return this.detail(meetingId, isHost, canManage);
  }

  async update(
    user: AuthenticatedUser,
    meetingId: string,
    body: UpdateMeetingBody,
    ctx: RequestContext,
  ) {
    const access = await this.access.requireManager(user, meetingId);
    const { meeting } = access;
    this.requireScheduled(meeting);
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.meeting.updateMany({
        where: { id: meetingId, status: 'SCHEDULED' },
        data: {
          title: body.title,
          scheduledAt: body.scheduledAt,
          aiNotesEnabled: body.aiNotesEnabled,
        },
      });
      if (count === 0) throw AppError.conflict(ENDED_MESSAGE);
      await this.auditTx(tx, ctx, {
        actorId: user.id,
        action: 'meeting.update',
        targetType: 'meeting',
        targetId: meetingId,
        workspaceId: meeting.workspaceId,
        metadata: {
          title: body.title,
          scheduledAt: body.scheduledAt?.toISOString(),
          aiNotesEnabled: body.aiNotesEnabled,
        },
      });
    });
    if (body.scheduledAt) await this.scheduleReminder(meetingId, body.scheduledAt);
    return this.detail(meetingId, access.isHost, true);
  }

  async cancel(user: AuthenticatedUser, meetingId: string, ctx: RequestContext) {
    const { meeting } = await this.access.requireManager(user, meetingId);
    this.requireScheduled(meeting);
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.meeting.updateMany({
        where: { id: meetingId, status: 'SCHEDULED' },
        data: { status: 'CANCELLED', endedAt: new Date(), endReason: 'cancelled' },
      });
      if (count === 0) throw AppError.conflict(ENDED_MESSAGE);
      await this.auditTx(tx, ctx, {
        actorId: user.id,
        action: 'meeting.cancel',
        targetType: 'meeting',
        targetId: meetingId,
        workspaceId: meeting.workspaceId,
        metadata: { title: meeting.title },
      });
    });
    const recipients = await this.notificationRecipients(meeting);
    await this.notifications.notify(
      recipients.filter((id) => id !== user.id),
      'meeting.cancelled',
      {
        meetingId,
        workspaceId: meeting.workspaceId,
        title: meeting.title,
        scheduledAt: meeting.scheduledAt?.toISOString() ?? null,
        byName: user.name,
      },
    );
  }

  async invite(user: AuthenticatedUser, meetingId: string, body: InviteBody, ctx: RequestContext) {
    const { meeting } = await this.access.requireManager(user, meetingId);
    this.requireScheduledOrLive(meeting);
    const targets = await this.resolveInvitees(user, body.emails);
    const added = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.meetingInvite.createManyAndReturn({
        data: targets.map((u) => ({ meetingId, userId: u.id, invitedById: user.id })),
        skipDuplicates: true,
      });
      const createdIds = new Set(created.map((c) => c.userId));
      const fresh = targets.filter((t) => createdIds.has(t.id));
      if (fresh.length > 0) {
        await this.auditTx(tx, ctx, {
          actorId: user.id,
          action: 'meeting.invite',
          targetType: 'meeting',
          targetId: meetingId,
          workspaceId: meeting.workspaceId,
          metadata: { userIds: fresh.map((u) => u.id), emails: fresh.map((u) => u.email) },
        });
      }
      return fresh;
    });
    if (added.length > 0) await this.notifyInvited(user, meeting, added);
    return { added };
  }

  async uninvite(user: AuthenticatedUser, meetingId: string, userId: string, ctx: RequestContext) {
    const { meeting } = await this.access.requireManager(user, meetingId);
    this.requireScheduledOrLive(meeting);
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.meetingInvite.deleteMany({ where: { meetingId, userId } });
      if (count === 0) throw AppError.notFound('Invite not found');
      await this.auditTx(tx, ctx, {
        actorId: user.id,
        action: 'meeting.uninvite',
        targetType: 'meeting',
        targetId: meetingId,
        workspaceId: meeting.workspaceId,
        metadata: { userId },
      });
    });
  }

  private async notificationRecipients(
    meeting: Pick<Meeting, 'id' | 'workspaceId' | 'createdById'>,
  ): Promise<string[]> {
    const db = this.prisma.client;
    const [invites, workspace] = await Promise.all([
      db.meetingInvite.findMany({ where: { meetingId: meeting.id }, select: { userId: true } }),
      db.workspace.findUnique({ where: { id: meeting.workspaceId }, select: { kind: true } }),
    ]);
    const recipients = new Set<string>([meeting.createdById]);
    for (const i of invites) recipients.add(i.userId);
    if (workspace?.kind === 'TEAM') {
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: meeting.workspaceId },
        select: { userId: true },
      });
      for (const m of members) recipients.add(m.userId);
    }
    const active = await db.user.findMany({
      where: { id: { in: [...recipients] }, status: 'ACTIVE' },
      select: { id: true },
    });
    return active.map((u) => u.id);
  }

  private auditTx(
    tx: Pick<Prisma.TransactionClient, 'auditLog'>,
    ctx: RequestContext,
    record: AuditRecord,
  ) {
    return writeAudit(tx, { ...record, ip: ctx.ip, userAgent: ctx.userAgent });
  }

  private requireScheduled(meeting: Meeting) {
    if (meeting.status === 'SCHEDULED') return;
    throw AppError.conflict(
      meeting.status === 'LIVE' ? 'This meeting has already started' : ENDED_MESSAGE,
    );
  }

  private requireScheduledOrLive(meeting: Meeting) {
    if (meeting.status === 'ENDED' || meeting.status === 'CANCELLED') {
      throw AppError.conflict(ENDED_MESSAGE);
    }
  }

  private async resolveInvitees(user: AuthenticatedUser, emails: string[]) {
    const unique = [...new Set(emails)].filter((e) => e !== user.email.toLowerCase());
    const resolved = [];
    for (const email of unique) {
      const target = await this.users.findOrProvision(email);
      if (target.id !== user.id) {
        resolved.push({
          id: target.id,
          email: target.email,
          name: target.name,
          avatarUrl: target.avatarUrl,
        });
      }
    }
    return resolved;
  }

  private notifyInvited(
    user: AuthenticatedUser,
    meeting: Pick<Meeting, 'id' | 'workspaceId' | 'title' | 'scheduledAt'>,
    invitees: Array<{ id: string }>,
  ) {
    return this.notifications.notify(
      invitees.map((i) => i.id),
      'meeting.invited',
      {
        meetingId: meeting.id,
        workspaceId: meeting.workspaceId,
        title: meeting.title,
        scheduledAt: meeting.scheduledAt?.toISOString() ?? null,
        byName: user.name,
      },
    );
  }

  private async attendeeCounts(meetingIds: string[]): Promise<Map<string, number>> {
    if (meetingIds.length === 0) return new Map();
    const rows = await this.prisma.client.meetingAttendance.groupBy({
      by: ['meetingId', 'userId'],
      where: { meetingId: { in: meetingIds } },
    });
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.meetingId, (counts.get(r.meetingId) ?? 0) + 1);
    return counts;
  }

  private async detail(meetingId: string, canHost: boolean, canManage: boolean) {
    const meeting = await this.prisma.client.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: {
        createdBy: { select: userSummary },
        invites: { orderBy: { createdAt: 'asc' }, select: { user: { select: userSummary } } },
        attendances: {
          orderBy: { joinedAt: 'asc' },
          select: { joinedAt: true, leftAt: true, user: { select: userSummary } },
        },
      },
    });
    const attendeeCount = new Set(meeting.attendances.map((a) => a.user.id)).size;
    return {
      ...this.toDto(meeting, attendeeCount),
      invitees: meeting.invites.map((i) => i.user),
      attendees: meeting.attendances.map((a) => ({
        ...a.user,
        joinedAt: a.joinedAt,
        leftAt: a.leftAt,
      })),
      opensAt:
        meeting.status === 'SCHEDULED' && meeting.scheduledAt
          ? new Date(meeting.scheduledAt.getTime() - this.config.MEETING_EARLY_JOIN_MIN * 60_000)
          : null,
      canHost,
      canManage,
    };
  }

  private toDto(m: MeetingRow, attendeeCount: number) {
    return {
      id: m.id,
      workspaceId: m.workspaceId,
      title: m.title,
      status: m.status,
      scheduledAt: m.scheduledAt,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      aiNotesEnabled: m.aiNotesEnabled,
      createdBy: m.createdBy,
      attendeeCount,
    };
  }
}
