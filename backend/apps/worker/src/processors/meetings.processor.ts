import {
  endMeeting,
  MEETING_ENDED_HOOK,
  MEETING_MEDIA,
  type MeetingEndedHook,
  type MeetingMedia,
  roomNameFor,
} from '@luna/meetings';
import { writeAudit, writeNotifications } from '@luna/db';
import {
  enqueueMinutes,
  type JobQueue,
  QUEUES,
  type QueueJob,
  type ScheduledJobQueue,
  unknownJob,
  upsertScheduler,
} from '@luna/shared';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';
import { PrismaService } from '../infra/prisma.provider.js';
import { NodeEventsPublisher } from '../infra/redis.provider.js';

const RECONCILE_EVERY_MS = 60_000;
const RECONCILE_PAGE = 200;
const RECONCILE_CONCURRENCY = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIVE_MS = 12 * 3_600_000;
const STALE_SCHEDULED_MS = 24 * 3_600_000;
const EMPTY_MARKER_TTL_FACTOR = 3;
const MINUTES_SWEEP_SLACK_MS = 5 * 60_000;
const STALE_PUBLISH_MS = 5 * 60_000;
const MINUTES_SWEEP_ATTEMPT = 900;
const LIVE_JOB_STATES = new Set([
  'waiting',
  'delayed',
  'active',
  'prioritized',
  'waiting-children',
]);
const emptyMarkerKey = (meetingId: string) => `meeting-empty-since:${meetingId}`;

export interface ReconcileResult {
  checked: number;
  ended: number;
  failed: number;
  cancelled: number;
  minutesRecovered: number;
  publishingReset: number;
}

async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

@Processor(QUEUES.MEETINGS)
export class MeetingsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeetingsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: NodeEventsPublisher,
    @Inject(MEETING_MEDIA) private readonly media: MeetingMedia,
    @Inject(MEETING_ENDED_HOOK) private readonly onEnded: MeetingEndedHook,
    @InjectQueue(QUEUES.MEETINGS) private readonly queue: ScheduledJobQueue<'meetings'>,
    @InjectQueue(QUEUES.MEETING_MINUTES) private readonly minutesQueue: Queue,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await upsertScheduler(this.queue, 'reconcile', { every: RECONCILE_EVERY_MS });
  }

  async process(job: Job): Promise<unknown> {
    const j = job as unknown as QueueJob<'meetings'>;
    switch (j.name) {
      case 'remind':
        return this.remind(j.data.meetingId, j.data.scheduledAt);
      case 'reconcile':
        return this.reconcile();
      default:
        throw new Error(`Unknown job "${unknownJob(j)}" on queue ${QUEUES.MEETINGS}`);
    }
  }

  async remind(meetingId: string, scheduledAt: string): Promise<{ sent: number }> {
    const db = this.prisma.client;
    const meeting = await db.meeting.findUnique({
      where: { id: meetingId },
      include: {
        invites: { select: { userId: true } },
        workspace: { select: { kind: true, deletedAt: true } },
      },
    });
    if (
      !meeting ||
      meeting.status !== 'SCHEDULED' ||
      meeting.workspace.deletedAt ||
      Date.now() > (meeting.scheduledAt?.getTime() ?? 0) ||
      meeting.scheduledAt?.toISOString() !== scheduledAt
    ) {
      return { sent: 0 };
    }
    const recipients = new Set<string>([meeting.createdById]);
    for (const i of meeting.invites) recipients.add(i.userId);
    if (meeting.workspace.kind === 'TEAM') {
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: meeting.workspaceId, user: { status: 'ACTIVE' } },
        select: { userId: true },
      });
      for (const m of members) recipients.add(m.userId);
    }
    const active = await db.user.findMany({
      where: { id: { in: [...recipients] }, status: 'ACTIVE' },
      select: { id: true },
    });
    await writeNotifications(
      db,
      (channel, message) => this.publisher.publishRaw(channel, message),
      active.map((u) => u.id),
      'meeting.reminder',
      {
        meetingId: meeting.id,
        workspaceId: meeting.workspaceId,
        title: meeting.title,
        scheduledAt,
      },
    );
    return { sent: active.length };
  }

  async reconcile(): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      checked: 0,
      ended: 0,
      failed: 0,
      cancelled: 0,
      minutesRecovered: 0,
      publishingReset: 0,
    };
    let after: string | undefined;
    for (;;) {
      const page = await this.prisma.client.meeting.findMany({
        where: { status: 'LIVE', ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: RECONCILE_PAGE,
        select: { id: true, startedAt: true },
      });
      if (page.length === 0) break;
      after = page[page.length - 1]!.id;
      await forEachLimited(page, RECONCILE_CONCURRENCY, async (m) => {
        result.checked++;
        try {
          if (await this.reconcileOne(m.id, m.startedAt)) result.ended++;
        } catch (err) {
          result.failed++;
          this.logger.error({ err, meetingId: m.id }, 'Meeting reconcile failed for a room');
        }
      });
      if (page.length < RECONCILE_PAGE) break;
    }
    try {
      result.cancelled = await this.cancelStaleScheduled();
    } catch (err) {
      this.logger.error({ err }, 'Stale scheduled meeting cleanup failed');
    }
    try {
      result.minutesRecovered = await this.recoverLostMinutes();
    } catch (err) {
      this.logger.error({ err }, 'Minutes recovery sweep failed');
    }
    try {
      result.publishingReset = await this.resetStalePublishing();
    } catch (err) {
      this.logger.error({ err }, 'Stale minutes publishing sweep failed');
    }
    if (
      result.ended ||
      result.failed ||
      result.cancelled ||
      result.minutesRecovered ||
      result.publishingReset
    ) {
      this.logger.log(
        `Reconciled ${result.checked} live meeting(s): ${result.ended} ended, ${result.failed} failed, ${result.cancelled} stale cancelled, ${result.minutesRecovered} minutes job(s) recovered, ${result.publishingReset} stuck publish(es) reopened`,
      );
    }
    return result;
  }

  private async resetStalePublishing(): Promise<number> {
    const db = this.prisma.client;
    const cutoff = new Date(Date.now() - STALE_PUBLISH_MS);
    let reset = 0;
    let after: string | undefined;
    for (;;) {
      const page = await db.meetingMinutes.findMany({
        where: {
          status: 'PUBLISHING',
          updatedAt: { lt: cutoff },
          ...(after ? { meetingId: { gt: after } } : {}),
        },
        orderBy: { meetingId: 'asc' },
        take: RECONCILE_PAGE,
        select: { meetingId: true, documentNodeId: true },
      });
      if (page.length === 0) break;
      after = page[page.length - 1]!.meetingId;
      for (const row of page) {
        try {
          if (row.documentNodeId) {
            await db.node.deleteMany({ where: { id: row.documentNodeId } });
          }
          const { count } = await db.meetingMinutes.updateMany({
            where: {
              meetingId: row.meetingId,
              status: 'PUBLISHING',
              updatedAt: { lt: cutoff },
            },
            data: { status: 'AWAITING_REVIEW', documentNodeId: null },
          });
          reset += count;
        } catch (err) {
          this.logger.error({ err, meetingId: row.meetingId }, 'Reopening stuck minutes failed');
        }
      }
      if (page.length < RECONCILE_PAGE) break;
    }
    return reset;
  }

  private async recoverLostMinutes(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.config.MEETING_AUDIO_WAIT_SEC * 1000 - MINUTES_SWEEP_SLACK_MS,
    );
    const sweepJobId = `minutes-%s-retry-${MINUTES_SWEEP_ATTEMPT}`;
    let recovered = 0;
    let after: string | undefined;
    for (;;) {
      const page = await this.prisma.client.meetingMinutes.findMany({
        where: {
          status: { in: ['RECORDING', 'PROCESSING'] },
          meeting: { is: { status: 'ENDED', endedAt: { lt: cutoff } } },
          ...(after ? { meetingId: { gt: after } } : {}),
        },
        orderBy: { meetingId: 'asc' },
        take: RECONCILE_PAGE,
        select: { meetingId: true },
      });
      if (page.length === 0) break;
      after = page[page.length - 1]!.meetingId;
      for (const { meetingId } of page) {
        const original = await this.minutesQueue.getJob(`minutes-${meetingId}`);
        if (original && LIVE_JOB_STATES.has(await original.getState())) continue;
        const sweep = await this.minutesQueue.getJob(sweepJobId.replace('%s', meetingId));
        if (sweep) {
          if (LIVE_JOB_STATES.has(await sweep.getState())) continue;
          await sweep.remove();
        }
        await enqueueMinutes(this.minutesQueue as JobQueue<'meeting-minutes'>, meetingId, {
          attempt: MINUTES_SWEEP_ATTEMPT,
        });
        recovered++;
      }
      if (page.length < RECONCILE_PAGE) break;
    }
    return recovered;
  }

  private async cancelStaleScheduled(): Promise<number> {
    const db = this.prisma.client;
    const cutoff = new Date(Date.now() - STALE_SCHEDULED_MS);
    let cancelled = 0;
    for (;;) {
      const stale = await db.meeting.findMany({
        where: { status: 'SCHEDULED', scheduledAt: { lt: cutoff } },
        orderBy: { id: 'asc' },
        take: RECONCILE_PAGE,
        select: { id: true, workspaceId: true, title: true },
      });
      if (stale.length === 0) break;
      let progressed = 0;
      for (const m of stale) {
        const done = await db.$transaction(async (tx) => {
          const { count } = await tx.meeting.updateMany({
            where: { id: m.id, status: 'SCHEDULED', scheduledAt: { lt: cutoff } },
            data: { status: 'CANCELLED', endedAt: new Date(), endReason: 'cancelled' },
          });
          if (count === 0) return false;
          await writeAudit(tx, {
            actorId: null,
            action: 'meeting.cancel',
            targetType: 'meeting',
            targetId: m.id,
            workspaceId: m.workspaceId,
            metadata: { title: m.title, reason: 'never_started' },
          });
          return true;
        });
        if (done) progressed++;
      }
      cancelled += progressed;
      if (progressed === 0 || stale.length < RECONCILE_PAGE) break;
    }
    return cancelled;
  }

  private end(meetingId: string): Promise<boolean> {
    return endMeeting(
      { db: this.prisma.client, media: this.media, onEnded: this.onEnded },
      meetingId,
      'empty',
      null,
    );
  }

  private async reconcileOne(meetingId: string, startedAt: Date | null): Promise<boolean> {
    const now = Date.now();
    const startedMs = startedAt?.getTime() ?? now;
    if (now - startedMs > MAX_LIVE_MS) return this.end(meetingId);
    const graceMs = this.config.MEETING_EMPTY_GRACE_SEC * 1000;
    const roomName = roomNameFor(meetingId);
    const participants = await this.media.listParticipants(roomName);
    if (participants === null) {
      if (now - startedMs <= graceMs) return false;
      const again = await this.media.listParticipants(roomName);
      if (again?.some((p) => !p.hidden)) return false;
      return this.end(meetingId);
    }
    const key = emptyMarkerKey(meetingId);
    if (participants.every((p) => p.hidden)) {
      await this.publisher.setIfAbsent(
        key,
        String(now),
        this.config.MEETING_EMPTY_GRACE_SEC * EMPTY_MARKER_TTL_FACTOR,
      );
      const since = Number(await this.publisher.getValue(key));
      if (!Number.isFinite(since) || now - since <= graceMs) return false;
      const again = await this.media.listParticipants(roomName);
      if (again?.some((p) => !p.hidden)) {
        await this.publisher.deleteKey(key);
        return false;
      }
      const ended = await this.end(meetingId);
      await this.publisher.deleteKey(key);
      return ended;
    }
    await this.publisher.deleteKey(key);
    const present = participants.map((p) => p.identity).filter((id) => UUID.test(id));
    await this.prisma.client.meetingAttendance.updateMany({
      where: {
        meetingId,
        leftAt: null,
        userId: { notIn: present },
        joinedAt: { lt: new Date(now - graceMs) },
      },
      data: { leftAt: new Date(now) },
    });
    return false;
  }
}
