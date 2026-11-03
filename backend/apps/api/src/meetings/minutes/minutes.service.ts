import type { DocJSON } from '@luna/editor';
import { writeAudit } from '@luna/db';
import {
  applyMentionConfirmations,
  collectMentionIds,
  type MentionSuggestion,
} from '@luna/meetings';
import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestContext } from '../../common/http/request-context.js';
import { ContentAccessService } from '../../content/content-access.service.js';
import { nameKey } from '../../content/node-names.js';
import { DocumentsService } from '../../documents/documents.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { NodeTree } from '../../content/node-tree.service.js';
import { SearchQueueService } from '../../infra/queue/search-queue.service.js';
import { MeetingAccess, type MeetingAccessResult } from '../meeting-access.service.js';
import { MinutesQueueService } from './minutes-queue.service.js';
import type { MinutesSummary, PublishBody, SaveDraftBody } from './minutes.schemas.js';

const FOLDER_NAME = 'Biên bản họp';
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const NOT_WAITING = 'These minutes are not waiting for review';
const REVISION_CONFLICT = 'Someone else saved these minutes, reload to see their changes';
const AUDIO_EXPIRED = 'The audio for this meeting has expired';
const NO_MINUTES = 'Minutes not found';
const NOT_FAILED = 'These minutes have not failed';
const NOT_RETRYABLE = 'These minutes cannot be retried';
const REASON_DRAFT = 'Không soạn được biên bản từ nội dung đã chép lời.';
const REASON_TRANSCRIBE = 'Không chép lời được âm thanh của buổi họp.';
const REASON_PURGED = 'Không chép lời được và âm thanh đã bị xoá nên không thể thử lại.';
const REASON_NOTHING_LEFT =
  'Không đoạn âm thanh nào chép lời được, chạy lại cũng không đổi kết quả.';
const REASON_CONFIG = 'Máy chủ chưa cấu hình biên bản AI.';
const REASON_UNKNOWN = 'Không tạo được biên bản.';
const MAX_TASKS_PER_PERSON = 20;
const MAX_TASK_CHARS = 200;
const RECIPIENT_CHECK_CONCURRENCY = 8;
const STALE_PUBLISH_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALT_FOLDER = new RegExp(`^${nameKey(FOLDER_NAME)} \\(\\d+\\)$`);

interface Failure {
  reason: string;
  retryable: boolean;
}

function describeFailure(
  failedStage: string | null,
  audioPurged: boolean,
  pendingChunks: number,
): Failure {
  if (failedStage === 'config') return { reason: REASON_CONFIG, retryable: false };
  if (failedStage === 'transcribe') {
    if (audioPurged) return { reason: REASON_PURGED, retryable: false };
    if (pendingChunks === 0) return { reason: REASON_NOTHING_LEFT, retryable: false };
    return { reason: REASON_TRANSCRIBE, retryable: true };
  }
  if (failedStage === 'draft') return { reason: REASON_DRAFT, retryable: true };
  return { reason: REASON_UNKNOWN, retryable: true };
}

const canReview = (a: Pick<MeetingAccessResult, 'isHost' | 'memberRole'>) =>
  a.isHost || a.memberRole === 'ADMIN';

function formatDate(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.day}/${parts.month}/${parts.year}`;
}

function safeName(value: string): string {
  return [...value]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      return code < 0x20 || code === 0x7f || ch === '/' || ch === '\\' ? ' ' : ch;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeMentions(
  node: DocJSON,
  allowed: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): DocJSON | null {
  if (node.type === 'mention') {
    const attrs = node.attrs ?? {};
    const id = String(attrs.id ?? '');
    const label = String(attrs.label ?? '');
    const fallback = label === '' ? null : { type: 'text', text: label };
    if (!UUID.test(id) || !allowed.has(id)) return fallback;
    const real = names.get(id);
    if (!real) return fallback;
    return { ...node, attrs: { ...attrs, label: real } };
  }
  if (!node.content) return node;
  const content: DocJSON[] = [];
  for (const child of node.content) {
    const next = sanitizeMentions(child, allowed, names);
    if (next) content.push(next);
  }
  return { ...node, content };
}

function textOf(node: DocJSON): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(textOf).join('');
}

function mentionsIn(node: DocJSON, out: string[] = []): string[] {
  if (node.type === 'mention' && node.attrs?.suggested !== true && node.attrs?.id) {
    out.push(String(node.attrs.id));
  }
  node.content?.forEach((c) => mentionsIn(c, out));
  return out;
}

function collectTasks(doc: DocJSON): Map<string, string[]> {
  const tasks = new Map<string, string[]>();
  const walk = (node: DocJSON) => {
    if (node.type === 'tableRow') {
      const cells = node.content ?? [];
      const title = cells[1] ? textOf(cells[1]).trim().slice(0, MAX_TASK_CHARS) : '';
      if (title) {
        for (const id of new Set(mentionsIn(node))) {
          const list = tasks.get(id) ?? [];
          if (list.length < MAX_TASKS_PER_PERSON) list.push(title);
          tasks.set(id, list);
        }
      }
      return;
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return tasks;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = Array.from<R>({ length: items.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

@Injectable()
export class MinutesService {
  private readonly logger = new Logger(MinutesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeetingAccess,
    private readonly content: ContentAccessService,
    private readonly tree: NodeTree,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly queue: MinutesQueueService,
    private readonly search: SearchQueueService,
  ) {}

  async summary(userId: string, meetingId: string): Promise<MinutesSummary> {
    const row = await this.prisma.client.meetingMinutes.findUnique({
      where: { meetingId },
      select: { status: true, documentNodeId: true },
    });
    if (!row) return { status: 'NONE', documentNodeId: null };
    return {
      status: row.status,
      documentNodeId: await this.visibleDocument(
        userId,
        row.status === 'PUBLISHED' ? row.documentNodeId : null,
      ),
    };
  }

  async get(user: AuthenticatedUser, meetingId: string) {
    const access = await this.access.require(user, meetingId);
    const reviewer = canReview(access);
    const row = await this.prisma.client.meetingMinutes.findUnique({ where: { meetingId } });
    if (!row) {
      return {
        status: 'NONE' as const,
        documentNodeId: null,
        canReview: reviewer,
        error: null,
        warning: null,
        failedStage: null,
        failureReason: null,
        canRetry: false,
        droppedItemCount: 0,
        draft: null,
      };
    }
    const documentNodeId = await this.visibleDocument(
      user.id,
      row.status === 'PUBLISHED' ? row.documentNodeId : null,
    );
    const awaiting = row.status === 'AWAITING_REVIEW';
    const draft =
      reviewer && awaiting && row.draftDoc
        ? {
            doc: row.draftDoc as Record<string, unknown>,
            revision: row.draftRevision,
            suggestions: (row.suggestions as MentionSuggestion[] | null) ?? [],
          }
        : null;
    const failure = row.status === 'FAILED' ? await this.failureOf(row) : null;
    return {
      status: row.status,
      documentNodeId,
      canReview: reviewer,
      error: reviewer && row.status === 'FAILED' ? row.error : null,
      warning: reviewer && awaiting ? row.error : null,
      failedStage: reviewer && row.status === 'FAILED' ? row.failedStage : null,
      failureReason: failure?.reason ?? null,
      canRetry: reviewer && !!failure?.retryable,
      droppedItemCount: reviewer ? row.droppedItemCount : 0,
      draft,
    };
  }

  async saveDraft(user: AuthenticatedUser, meetingId: string, body: SaveDraftBody) {
    const { meeting } = await this.requireReviewer(user, meetingId);
    const row = await this.prisma.client.meetingMinutes.findUnique({
      where: { meetingId },
      select: { suggestions: true },
    });
    const people = await this.participants(meetingId, meeting.createdById);
    const doc = await this.cleanMentions(
      body.doc as DocJSON,
      (row?.suggestions as MentionSuggestion[] | null) ?? [],
      people,
    );
    const { count } = await this.prisma.client.meetingMinutes.updateMany({
      where: { meetingId, status: 'AWAITING_REVIEW', draftRevision: body.revision },
      data: { draftDoc: doc as object, draftRevision: { increment: 1 } },
    });
    if (count === 0) throw await this.claimConflict(meetingId);
    return { revision: body.revision + 1 };
  }

  async publish(
    user: AuthenticatedUser,
    meetingId: string,
    body: PublishBody,
    ctx: RequestContext,
  ) {
    const { meeting } = await this.requireReviewer(user, meetingId);
    const claimed = await this.prisma.client.meetingMinutes.updateMany({
      where: {
        meetingId,
        draftRevision: body.revision,
        OR: [
          { status: 'AWAITING_REVIEW' },
          { status: 'PUBLISHING', updatedAt: { lt: new Date(Date.now() - STALE_PUBLISH_MS) } },
        ],
      },
      data: { status: 'PUBLISHING' },
    });
    if (claimed.count === 0) throw await this.claimConflict(meetingId);

    let nodeId: string | null = null;
    let doc: DocJSON;
    let people: Awaited<ReturnType<MinutesService['participants']>>;
    try {
      const row = await this.prisma.client.meetingMinutes.findUniqueOrThrow({
        where: { meetingId },
      });
      if (row.documentNodeId) {
        await this.prisma.client.node
          .delete({ where: { id: row.documentNodeId } })
          .catch((err) =>
            this.logger.error(
              { err, nodeId: row.documentNodeId },
              'Could not remove stale minutes',
            ),
          );
        await this.prisma.client.meetingMinutes.update({
          where: { meetingId },
          data: { documentNodeId: null },
        });
      }
      people = await this.participants(meetingId, meeting.createdById);
      const suggestions = (row.suggestions as MentionSuggestion[] | null) ?? [];
      const suggestable = new Set(suggestions.map((s) => s.userId));
      const confirmed = new Set(body.confirmedUserIds.filter((id) => suggestable.has(id)));
      const cleaned = await this.cleanMentions(row.draftDoc as DocJSON, suggestions, people);
      doc = await this.cleanMentions(
        applyMentionConfirmations(cleaned, confirmed),
        suggestions,
        people,
      );

      const folderId = await this.ensureFolder(user, meeting.workspaceId, ctx);
      const startedAt = meeting.startedAt ?? meeting.createdAt;
      const name = `Biên bản: ${safeName(meeting.title)} · ${formatDate(startedAt)}`;
      const node = await this.documents.createWithContent(
        user,
        { workspaceId: meeting.workspaceId, parentId: folderId, name, json: doc, autoRename: true },
        ctx,
        false,
      );
      nodeId = node.id;
      const held = await this.prisma.client.meetingMinutes.updateMany({
        where: { meetingId, status: 'PUBLISHING', documentNodeId: null },
        data: { documentNodeId: node.id },
      });
      if (held.count === 0) throw AppError.conflict(NOT_WAITING);
      await this.finalize(user, meeting.workspaceId, meetingId, node, people, ctx);
    } catch (err) {
      await this.rollback(meetingId, nodeId);
      throw err;
    }
    await this.search.node(nodeId);
    try {
      await this.notifyPublished(user, meeting, nodeId, doc, people);
    } catch (err) {
      this.logger.error({ err, meetingId }, 'Could not notify about published minutes');
    }
    return { documentNodeId: nodeId };
  }

  async retry(user: AuthenticatedUser, meetingId: string, ctx: RequestContext) {
    const { meeting } = await this.requireReviewer(user, meetingId);
    const row = await this.prisma.client.meetingMinutes.findUnique({ where: { meetingId } });
    if (!row) throw AppError.notFound(NO_MINUTES);
    if (row.status !== 'FAILED') throw AppError.conflict(NOT_FAILED);
    if (row.failedStage === 'transcribe' && row.audioPurgedAt) {
      throw AppError.conflict(AUDIO_EXPIRED);
    }
    if (!(await this.failureOf(row)).retryable) throw AppError.conflict(NOT_RETRYABLE);
    const attempt = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.meetingMinutes.updateMany({
        where: { meetingId, status: 'FAILED' },
        data: { status: 'PROCESSING', claimedBy: null, claimExpiresAt: null },
      });
      if (count === 0) throw AppError.conflict(NOT_FAILED);
      const previous = await tx.auditLog.count({
        where: { action: 'meeting.minutes_retry', targetType: 'meeting', targetId: meetingId },
      });
      await writeAudit(tx, {
        actorId: user.id,
        action: 'meeting.minutes_retry',
        targetType: 'meeting',
        targetId: meetingId,
        workspaceId: meeting.workspaceId,
        metadata: { attempt: previous + 1, failedStage: row.failedStage },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return previous + 1;
    });
    try {
      await this.queue.retryMinutes(meetingId, attempt);
    } catch (err) {
      this.logger.error({ err, meetingId }, 'Could not enqueue the minutes retry');
      await this.prisma.client.meetingMinutes
        .updateMany({
          where: { meetingId, status: 'PROCESSING', claimedBy: null },
          data: { status: 'FAILED' },
        })
        .catch((e) => this.logger.error({ err: e, meetingId }, 'Could not revert the retry'));
      throw AppError.unavailable('The retry could not be queued, try again in a moment');
    }
    return { attempt };
  }

  private async failureOf(row: {
    meetingId: string;
    failedStage: string | null;
    audioPurgedAt: Date | null;
  }): Promise<Failure> {
    const pending =
      row.failedStage === 'transcribe' && !row.audioPurgedAt
        ? await this.prisma.client.meetingAudioChunk.count({
            where: { meetingId: row.meetingId, transcribedAt: null, deletedAt: null },
          })
        : 0;
    return describeFailure(row.failedStage, row.audioPurgedAt !== null, pending);
  }

  private async requireReviewer(user: AuthenticatedUser, meetingId: string) {
    const access = await this.access.require(user, meetingId);
    if (!canReview(access)) {
      throw AppError.forbidden('Only the meeting host or a workspace admin can do this');
    }
    const exists = await this.prisma.client.meetingMinutes.count({ where: { meetingId } });
    if (exists === 0) throw AppError.notFound(NO_MINUTES);
    return access;
  }

  private async claimConflict(meetingId: string): Promise<AppError> {
    const row = await this.prisma.client.meetingMinutes.findUnique({
      where: { meetingId },
      select: { status: true },
    });
    if (!row) return AppError.notFound(NO_MINUTES);
    return AppError.conflict(row.status === 'AWAITING_REVIEW' ? REVISION_CONFLICT : NOT_WAITING);
  }

  private async visibleDocument(userId: string, nodeId: string | null): Promise<string | null> {
    if (!nodeId) return null;
    const access = (await this.content.resolveMany(userId, [nodeId])).get(nodeId);
    return access?.role && !access.deletedAt ? nodeId : null;
  }

  private async ensureFolder(
    user: AuthenticatedUser,
    workspaceId: string,
    ctx: RequestContext,
  ): Promise<string> {
    const rootWhere = {
      workspaceId,
      section: 'DOCS' as const,
      parentId: null,
      deletedAt: null,
    };
    const find = () =>
      this.prisma.client.node.findFirst({
        where: { ...rootWhere, nameNormalized: nameKey(FOLDER_NAME) },
        select: { id: true, type: true },
      });
    const findAlternative = async () => {
      const candidates = await this.prisma.client.node.findMany({
        where: {
          ...rootWhere,
          type: 'FOLDER',
          nameNormalized: { startsWith: `${nameKey(FOLDER_NAME)} (` },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, nameNormalized: true },
      });
      return candidates.find((c) => ALT_FOLDER.test(c.nameNormalized))?.id ?? null;
    };
    const create = async (autoRename: boolean) =>
      (
        await this.tree.create(
          user,
          {
            workspaceId,
            parentId: null,
            section: 'DOCS',
            type: 'FOLDER',
            name: FOLDER_NAME,
            autoRename,
          },
          ctx,
        )
      ).id;
    const existing = await find();
    if (existing?.type === 'FOLDER') return existing.id;
    if (existing) return (await findAlternative()) ?? (await create(true));
    try {
      return await create(false);
    } catch (err) {
      if (!(err instanceof AppError) || err.status !== 409) throw err;
      const again = await find();
      if (again?.type === 'FOLDER') return again.id;
      return (await findAlternative()) ?? (await create(true));
    }
  }

  private async cleanMentions(
    doc: DocJSON,
    suggestions: MentionSuggestion[],
    people: { hostId: string; invited: Set<string>; attended: Set<string> },
  ): Promise<DocJSON> {
    const allowed = new Set<string>([
      people.hostId,
      ...people.invited,
      ...people.attended,
      ...suggestions.map((s) => s.userId),
    ]);
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: [...allowed] } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return sanitizeMentions(doc, allowed, names) ?? doc;
  }

  private async participants(meetingId: string, hostId: string) {
    const db = this.prisma.client;
    const [invites, attendances] = await Promise.all([
      db.meetingInvite.findMany({ where: { meetingId }, select: { userId: true } }),
      db.meetingAttendance.findMany({
        where: { meetingId },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);
    return {
      hostId,
      invited: new Set(invites.map((i) => i.userId)),
      attended: new Set(attendances.map((a) => a.userId)),
    };
  }

  private async finalize(
    user: AuthenticatedUser,
    workspaceId: string,
    meetingId: string,
    node: { id: string; name: string; parentId: string | null },
    people: { invited: Set<string>; attended: Set<string> },
    ctx: RequestContext,
  ) {
    const everyone = [...new Set([...people.invited, ...people.attended])].filter(
      (id) => id !== user.id,
    );
    const members = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId, userId: { in: everyone } },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((m) => m.userId));
    const outsiders = everyone.filter((id) => !memberIds.has(id));
    await this.prisma.client.$transaction(async (tx) => {
      if (outsiders.length > 0) {
        const created = await tx.nodeShare.createManyAndReturn({
          data: outsiders.map((userId) => ({
            nodeId: node.id,
            userId,
            role: 'VIEWER' as const,
            grantedById: user.id,
          })),
          skipDuplicates: true,
          select: { userId: true },
        });
        for (const share of created) {
          await writeAudit(tx, {
            actorId: user.id,
            action: 'share.add',
            targetType: 'node',
            targetId: node.id,
            workspaceId,
            metadata: { userId: share.userId, role: 'VIEWER', via: 'meeting' },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
      }
      const { count } = await tx.meetingMinutes.updateMany({
        where: { meetingId, status: 'PUBLISHING', documentNodeId: node.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: user.id },
      });
      if (count === 0) throw AppError.conflict(NOT_WAITING);
      await writeAudit(tx, {
        actorId: user.id,
        action: 'meeting.minutes_publish',
        targetType: 'node',
        targetId: node.id,
        workspaceId,
        metadata: { meetingId, name: node.name, parentId: node.parentId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    });
  }

  private async notifyPublished(
    user: AuthenticatedUser,
    meeting: { id: string; workspaceId: string; title: string },
    nodeId: string,
    doc: DocJSON,
    people: { hostId: string; invited: Set<string>; attended: Set<string> },
  ) {
    const mentioned = new Set(collectMentionIds(doc));
    const candidates = [
      ...new Set([people.hostId, ...people.invited, ...people.attended, ...mentioned]),
    ].filter((id) => id !== user.id);
    const checks = await mapLimited(candidates, RECIPIENT_CHECK_CONCURRENCY, async (id) => {
      try {
        const access = (await this.content.resolveMany(id, [nodeId])).get(nodeId);
        return access?.role && access.userActive && !access.deletedAt ? id : null;
      } catch (err) {
        this.logger.warn({ err, userId: id }, 'Could not check minutes access for a recipient');
        return null;
      }
    });
    const recipients = checks.filter((id): id is string => id !== null);
    if (recipients.length === 0) return;
    const base = {
      meetingId: meeting.id,
      workspaceId: meeting.workspaceId,
      nodeId,
      title: meeting.title,
    };
    await this.notifications.notify(recipients, 'meeting.minutes_published', base);
    const tasks = collectTasks(doc);
    for (const id of recipients) {
      if (!mentioned.has(id)) continue;
      await this.notifications.notify([id], 'meeting.minutes_assigned', {
        ...base,
        tasks: tasks.get(id) ?? [],
      });
    }
  }

  private async rollback(meetingId: string, nodeId: string | null) {
    if (nodeId) {
      await this.prisma.client.node
        .delete({ where: { id: nodeId } })
        .catch((err) => this.logger.error({ err, nodeId }, 'Could not remove orphaned minutes'));
    }
    await this.prisma.client.meetingMinutes
      .updateMany({
        where: {
          meetingId,
          status: 'PUBLISHING',
          OR: [{ documentNodeId: nodeId }, { documentNodeId: null }],
        },
        data: { status: 'AWAITING_REVIEW', documentNodeId: null },
      })
      .catch((err) => this.logger.error({ err, meetingId }, 'Could not reopen minutes'));
  }
}
