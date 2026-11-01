import {
  endMeeting,
  MEETING_ENDED_HOOK,
  MEETING_MEDIA,
  type MeetingEndedHook,
  type MeetingMedia,
  roomNameFor,
} from '@luna/meetings';
import { writeNotifications } from '@luna/db';
import { JOBS, QUEUES, type QueueJob, unknownJob } from '@luna/shared';
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

export interface ReconcileResult {
  checked: number;
  ended: number;
  failed: number;
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
    @InjectQueue(QUEUES.MEETINGS) private readonly queue: Queue,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      JOBS.MEETING_RECONCILE,
      { every: RECONCILE_EVERY_MS },
      {
        name: JOBS.MEETING_RECONCILE,
        opts: { removeOnComplete: 30, removeOnFail: 100 },
      },
    );
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
    await writeNotifications(
      db,
      (channel, message) => this.publisher.publishRaw(channel, message),
      recipients,
      'meeting.reminder',
      {
        meetingId: meeting.id,
        workspaceId: meeting.workspaceId,
        title: meeting.title,
        scheduledAt,
      },
    );
    return { sent: recipients.size };
  }

  async reconcile(): Promise<ReconcileResult> {
    const result: ReconcileResult = { checked: 0, ended: 0, failed: 0 };
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
    if (result.ended || result.failed) {
      this.logger.log(
        `Reconciled ${result.checked} live meeting(s): ${result.ended} ended, ${result.failed} failed`,
      );
    }
    return result;
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
    const participants = await this.media.listParticipants(roomNameFor(meetingId));
    const visible = participants?.filter((p) => !p.hidden) ?? [];
    if (visible.length === 0) {
      return now - startedMs > graceMs ? this.end(meetingId) : false;
    }
    const present = participants!.map((p) => p.identity).filter((id) => UUID.test(id));
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
