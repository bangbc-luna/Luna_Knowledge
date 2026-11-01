import type { Meeting, Prisma } from '@luna/db';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentAccessService,
    private readonly access: MeetingAccess,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateMeetingBody,
    ctx: RequestContext,
  ) {
    await this.content.requireMember(user, workspaceId, 'MEMBER');
    const invitees = await this.resolveInvitees(user, body.inviteeEmails);
    const scheduledAt = body.mode === 'instant' ? new Date() : body.scheduledAt!;
    const meeting = await this.prisma.client.meeting.create({
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
    await this.audit.log({
      actorId: user.id,
      action: 'meeting.create',
      targetType: 'meeting',
      targetId: meeting.id,
      workspaceId,
      metadata: {
        title: meeting.title,
        mode: body.mode,
        scheduledAt: scheduledAt.toISOString(),
        aiNotesEnabled: meeting.aiNotesEnabled,
        inviteeCount: invitees.length,
      },
      ctx,
    });
    await this.notifyInvited(user, meeting, invitees);
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
    return {
      items: items.map((m) => this.toDto(m, counts.get(m.id) ?? 0)),
      nextCursor: hasMore && last ? encodeKeysetCursor(last[field]!, last.id) : null,
    };
  }

  async get(user: AuthenticatedUser, meetingId: string) {
    const { isHost } = await this.access.require(user, meetingId);
    return this.detail(meetingId, isHost);
  }

  async update(
    user: AuthenticatedUser,
    meetingId: string,
    body: UpdateMeetingBody,
    ctx: RequestContext,
  ) {
    const { meeting } = await this.access.requireHost(user, meetingId);
    this.requireScheduled(meeting);
    const { count } = await this.prisma.client.meeting.updateMany({
      where: { id: meetingId, status: 'SCHEDULED' },
      data: {
        title: body.title,
        scheduledAt: body.scheduledAt,
        aiNotesEnabled: body.aiNotesEnabled,
      },
    });
    if (count === 0) throw AppError.conflict(ENDED_MESSAGE);
    await this.audit.log({
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
      ctx,
    });
    return this.detail(meetingId, true);
  }

  async cancel(user: AuthenticatedUser, meetingId: string, ctx: RequestContext) {
    const { meeting } = await this.access.requireHost(user, meetingId);
    this.requireScheduled(meeting);
    const { count } = await this.prisma.client.meeting.updateMany({
      where: { id: meetingId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED', endedAt: new Date(), endReason: 'cancelled' },
    });
    if (count === 0) throw AppError.conflict(ENDED_MESSAGE);
    await this.audit.log({
      actorId: user.id,
      action: 'meeting.cancel',
      targetType: 'meeting',
      targetId: meetingId,
      workspaceId: meeting.workspaceId,
      metadata: { title: meeting.title },
      ctx,
    });
    const invites = await this.prisma.client.meetingInvite.findMany({
      where: { meetingId },
      select: { userId: true },
    });
    await this.notifications.notify(
      invites.map((i) => i.userId).filter((id) => id !== user.id),
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
    const { meeting } = await this.access.requireHost(user, meetingId);
    this.requireScheduledOrLive(meeting);
    const targets = await this.resolveInvitees(user, body.emails);
    const existing = await this.prisma.client.meetingInvite.findMany({
      where: { meetingId, userId: { in: targets.map((t) => t.id) } },
      select: { userId: true },
    });
    const have = new Set(existing.map((e) => e.userId));
    const added = targets.filter((t) => !have.has(t.id));
    if (added.length > 0) {
      await this.prisma.client.meetingInvite.createMany({
        data: added.map((u) => ({ meetingId, userId: u.id, invitedById: user.id })),
        skipDuplicates: true,
      });
      await this.audit.log({
        actorId: user.id,
        action: 'meeting.invite',
        targetType: 'meeting',
        targetId: meetingId,
        workspaceId: meeting.workspaceId,
        metadata: { userIds: added.map((u) => u.id), emails: added.map((u) => u.email) },
        ctx,
      });
      await this.notifyInvited(user, meeting, added);
    }
    return { added };
  }

  async uninvite(user: AuthenticatedUser, meetingId: string, userId: string, ctx: RequestContext) {
    const { meeting } = await this.access.requireHost(user, meetingId);
    const { count } = await this.prisma.client.meetingInvite.deleteMany({
      where: { meetingId, userId },
    });
    if (count === 0) throw AppError.notFound('Invite not found');
    await this.audit.log({
      actorId: user.id,
      action: 'meeting.uninvite',
      targetType: 'meeting',
      targetId: meetingId,
      workspaceId: meeting.workspaceId,
      metadata: { userId },
      ctx,
    });
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

  private async detail(meetingId: string, canHost: boolean) {
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
      canHost,
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
