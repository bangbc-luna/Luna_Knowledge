import { type Prisma, writeAudit, writeNotifications } from '@luna/db';
import {
  buildMinutesUserMessage,
  buildTimeline,
  limitTimeline,
  llmCostMicroUsd,
  matchPerson,
  minutesAiAvailable,
  MAX_TIMELINE_CHARS,
  MINUTES_OUTPUT_RULES,
  MINUTES_SYSTEM_PROMPT,
  MinutesWriterError,
  type MentionSuggestion,
  type MinutesDraft,
  type MinutesWriter,
  renderMinutesDoc,
  type SpeechToText,
  sttCostMicroUsd,
  SttError,
  validateDraft,
} from '@luna/meetings';
import { JOBS, ObjectStore, QUEUES, type QueueJob, unknownJob } from '@luna/shared';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DelayedError, type Job, type Queue, UnrecoverableError } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';
import { PrismaService } from '../infra/prisma.provider.js';
import { NodeEventsPublisher } from '../infra/redis.provider.js';

export const SPEECH_TO_TEXT = Symbol('SPEECH_TO_TEXT');
export const MINUTES_WRITER = Symbol('MINUTES_WRITER');

const TRANSCRIBE_CONCURRENCY = 4;
const AUDIO_WAIT_RECHECK_MS = 30_000;
const PURGE_BATCH = 100;
const MAX_ERROR_CHARS = 500;
const WARNING_PREFIX = 'Cảnh báo: ';
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const CLAIM_LEASE_MS = 15 * 60_000;
const MAX_TRANSCRIBE_ROUNDS = 5;
const SKIP_WARNING_PREFIX = 'bỏ qua ';
const BILLING_ERROR =
  /quota|billing|payment|insufficient|balance|credit|unauthori[sz]ed|forbidden|api key/i;
const CONTENT_STATUSES = new Set([400, 413, 415, 422]);
const DONE_STATUSES = new Set(['AWAITING_REVIEW', 'PUBLISHING', 'PUBLISHED']);

type Stage = 'transcribe' | 'draft';

const NOT_CONFIGURED = 'AI minutes are not configured';

const EMPTY_DRAFT: MinutesDraft = {
  overview: { summary: '', decisions: [], deferred: [], openQuestions: [] },
  actionItems: [],
  topics: [],
  notableChat: [],
};

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

async function readAll(body: AsyncIterable<unknown>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of body) parts.push(Buffer.from(part as Uint8Array));
  return Buffer.concat(parts);
}

class ClaimLost extends Error {}

class StageFailure extends Error {}

function isSkippable(err: unknown, lastAttempt: boolean): boolean {
  if (isMissingObject(err)) return true;
  if (err instanceof SttError && err.kind === 'blocked') return lastAttempt;
  if (!(err instanceof SttError) || err.retryable) return false;
  if (BILLING_ERROR.test(err.message)) return false;
  return err.status === undefined || CONTENT_STATUSES.has(err.status);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof StageFailure) return false;
  if (err instanceof SttError || err instanceof MinutesWriterError) return err.retryable;
  return true;
}

function isMissingObject(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

function warningLines(error: string | null): string[] {
  if (!error?.startsWith(WARNING_PREFIX)) return [];
  return error.slice(WARNING_PREFIX.length).split('; ').filter(Boolean);
}

function joinWarnings(lines: Iterable<string>): string | null {
  const unique = [...new Set(lines)];
  if (unique.length === 0) return null;
  return `${WARNING_PREFIX}${unique.join('; ')}`.slice(0, MAX_ERROR_CHARS);
}

@Processor(QUEUES.MEETING_MINUTES, { concurrency: 1 })
export class MeetingMinutesProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeetingMinutesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ObjectStore,
    private readonly publisher: NodeEventsPublisher,
    @Inject(SPEECH_TO_TEXT) private readonly stt: SpeechToText | null,
    @Inject(MINUTES_WRITER) private readonly writer: MinutesWriter | null,
    @InjectQueue(QUEUES.MEETING_MINUTES) private readonly queue: Queue,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    this.worker.concurrency = this.config.MEETING_MINUTES_CONCURRENCY;
    await this.queue.upsertJobScheduler(
      JOBS.MINUTES_PURGE_AUDIO,
      { pattern: '0 4 * * *', tz: TIME_ZONE },
      { name: JOBS.MINUTES_PURGE_AUDIO, opts: { removeOnComplete: 30, removeOnFail: 100 } },
    );
  }

  async process(job: Job, token?: string): Promise<unknown> {
    const j = job as unknown as QueueJob<'meeting-minutes'>;
    switch (j.name) {
      case 'process':
        return this.processMeeting(job, j.data.meetingId, token);
      case 'purge-audio':
        return this.purgeAudio();
      default:
        throw new Error(`Unknown job "${unknownJob(j)}" on queue ${QUEUES.MEETING_MINUTES}`);
    }
  }

  private redact(message: string): string {
    let out = message;
    for (const secret of [
      this.config.OMNIROUTE_API_KEY,
      this.config.DEEPGRAM_API_KEY,
      this.config.GEMINI_API_KEY,
      this.config.ANTHROPIC_API_KEY,
    ]) {
      if (secret) out = out.split(secret).join('[redacted]');
    }
    return out.replace(/\s+/g, ' ').slice(0, MAX_ERROR_CHARS);
  }

  private async processMeeting(job: Job, meetingId: string, token?: string) {
    const db = this.prisma.client;
    const meeting = await db.meeting.findUnique({
      where: { id: meetingId },
      include: { minutes: true, createdBy: { select: { id: true, name: true } } },
    });
    const minutes = meeting?.minutes;
    if (!meeting || !minutes) return { skipped: 'no_minutes' };
    if (DONE_STATUSES.has(minutes.status)) return { skipped: minutes.status };
    if (meeting.status !== 'ENDED') {
      if (meeting.status !== 'LIVE' && meeting.status !== 'SCHEDULED') {
        return { skipped: 'not_ended' };
      }
      if (!token) throw new Error('The meeting has not ended yet');
      await job.moveToDelayed(Date.now() + AUDIO_WAIT_RECHECK_MS, token);
      throw new DelayedError();
    }

    const { stt, writer } = this;
    if (!stt || !writer || !minutesAiAvailable(this.config)) {
      return this.failNotConfigured(meeting);
    }

    const waitMs = this.config.MEETING_AUDIO_WAIT_SEC * 1000;
    if (
      !minutes.audioCompletedAt &&
      meeting.endedAt &&
      Date.now() - meeting.endedAt.getTime() < waitMs
    ) {
      if (!token) throw new Error('Audio is not complete yet');
      await job.moveToDelayed(Date.now() + AUDIO_WAIT_RECHECK_MS, token);
      throw new DelayedError();
    }

    const jobId = String(job.id ?? `${meetingId}:${token ?? 'local'}`);
    const now = Date.now();
    const claim = await db.meetingMinutes.updateMany({
      where: {
        meetingId,
        OR: [
          { status: 'RECORDING' },
          {
            status: 'PROCESSING',
            OR: [
              { claimedBy: jobId },
              { claimedBy: null },
              { claimExpiresAt: null },
              { claimExpiresAt: { lt: new Date(now) } },
            ],
          },
        ],
      },
      data: {
        status: 'PROCESSING',
        claimedBy: jobId,
        claimExpiresAt: new Date(now + CLAIM_LEASE_MS),
        failedStage: null,
        ...(minutes.error?.startsWith(WARNING_PREFIX) ? {} : { error: null }),
      },
    });
    if (claim.count === 0) return { skipped: 'claimed_elsewhere' };

    const warnings = new Set(
      warningLines(minutes.error).filter((line) => !line.startsWith(SKIP_WARNING_PREFIX)),
    );
    let stage: Stage = 'transcribe';
    try {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.transcribeChunks(meeting.id, meeting.workspaceId, jobId, stt, lastAttempt);
      const skipped = await this.skippedChunkCount(meeting.id);
      if (skipped.skipped > 0) {
        if (skipped.succeeded === 0) {
          const chat = await db.meetingChatMessage.count({ where: { meetingId } });
          if (chat === 0) throw new StageFailure('Mọi đoạn âm thanh đều không chép lời được');
          warnings.add('không chép lời được đoạn âm thanh nào, bản nháp chỉ có tin nhắn chat');
        } else {
          warnings.add(
            `${SKIP_WARNING_PREFIX}${skipped.skipped} đoạn âm thanh không chép lời được, âm thanh được giữ tới khi hết hạn`,
          );
        }
      }
      await db.meetingMinutes.updateMany({
        where: { meetingId, transcriptCompletedAt: null },
        data: { transcriptCompletedAt: new Date() },
      });
      await this.purgeChunks(meeting.id, { onlyTranscribed: true });
      stage = 'draft';
      await this.renewClaim(meetingId, jobId);
      return await this.buildDraft(meeting, warnings, jobId, writer);
    } catch (err) {
      if (err instanceof ClaimLost) return { skipped: 'claim_lost' };
      return this.fail(job, meeting, stage, err, jobId);
    }
  }

  private async failNotConfigured(meeting: {
    id: string;
    workspaceId: string;
    title: string;
    createdById: string;
  }) {
    const { count } = await this.prisma.client.meetingMinutes.updateMany({
      where: { meetingId: meeting.id, status: { in: ['RECORDING', 'PROCESSING'] } },
      data: {
        status: 'FAILED',
        failedStage: 'config',
        error: NOT_CONFIGURED,
        claimedBy: null,
        claimExpiresAt: null,
      },
    });
    if (count === 1) {
      await this.notify([meeting.createdById], 'meeting.minutes_failed', {
        meetingId: meeting.id,
        workspaceId: meeting.workspaceId,
        title: meeting.title,
        stage: 'config',
      });
    }
    this.logger.error(`Minutes ${meeting.id} cannot run: ${NOT_CONFIGURED}`);
    return { skipped: 'config' };
  }

  private async renewClaim(meetingId: string, jobId: string): Promise<void> {
    const { count } = await this.prisma.client.meetingMinutes.updateMany({
      where: { meetingId, status: 'PROCESSING', claimedBy: jobId },
      data: { claimExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS) },
    });
    if (count === 0) throw new ClaimLost();
  }

  private async skippedChunkCount(meetingId: string) {
    const db = this.prisma.client;
    const [skipped, succeeded] = await Promise.all([
      db.meetingAudioChunk.count({ where: { meetingId, skippedAt: { not: null } } }),
      db.meetingAiUsage.count({ where: { meetingId, kind: 'stt' } }),
    ]);
    return { skipped, succeeded };
  }

  private async fail(
    job: Job,
    meeting: { id: string; workspaceId: string; title: string; createdById: string },
    stage: Stage,
    err: unknown,
    jobId: string,
  ): Promise<never> {
    const retryable = isRetryable(err);
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const message = this.redact(err instanceof Error ? err.message : String(err));
    const db = this.prisma.client;
    if (retryable && !lastAttempt) {
      this.logger.warn(`Minutes ${meeting.id} stage ${stage} failed, will retry: ${message}`);
      await db.meetingMinutes.updateMany({
        where: { meetingId: meeting.id, status: 'PROCESSING', claimedBy: jobId },
        data: { claimedBy: null, claimExpiresAt: null },
      });
      throw err;
    }
    const { count } = await db.meetingMinutes.updateMany({
      where: { meetingId: meeting.id, status: 'PROCESSING', claimedBy: jobId },
      data: {
        status: 'FAILED',
        failedStage: stage,
        error: message,
        claimedBy: null,
        claimExpiresAt: null,
      },
    });
    if (count === 1) {
      await this.notify([meeting.createdById], 'meeting.minutes_failed', {
        meetingId: meeting.id,
        workspaceId: meeting.workspaceId,
        title: meeting.title,
        stage,
      });
    }
    this.logger.error(`Minutes ${meeting.id} failed at ${stage}: ${message}`);
    if (!retryable) throw new UnrecoverableError(message);
    throw err;
  }

  private async notify(userIds: string[], type: string, payload: Prisma.InputJsonObject) {
    try {
      await writeNotifications(
        this.prisma.client,
        (channel, message) => this.publisher.publishRaw(channel, message),
        userIds,
        type,
        payload,
      );
    } catch (err) {
      this.logger.error({ err, type }, 'Sending a minutes notification failed');
    }
  }

  private async transcribeChunks(
    meetingId: string,
    workspaceId: string,
    jobId: string,
    stt: SpeechToText,
    lastAttempt: boolean,
  ): Promise<void> {
    const db = this.prisma.client;
    for (let round = 0; round < MAX_TRANSCRIBE_ROUNDS; round++) {
      const chunks = await db.meetingAudioChunk.findMany({
        where: { meetingId, transcribedAt: null, deletedAt: null },
        orderBy: { startOffsetMs: 'asc' },
      });
      if (chunks.length === 0) return;
      let firstError: unknown;
      let lost: ClaimLost | undefined;
      await forEachLimited(chunks, TRANSCRIBE_CONCURRENCY, async (chunk) => {
        if (lost) return;
        try {
          await this.renewClaim(meetingId, jobId);
        } catch (err) {
          if (err instanceof ClaimLost) lost = err;
          else firstError ??= err;
          return;
        }
        try {
          await this.transcribeChunk(meetingId, workspaceId, chunk, stt);
        } catch (err) {
          if (isSkippable(err, lastAttempt)) {
            const now = new Date();
            await db.meetingAudioChunk.updateMany({
              where: { id: chunk.id, transcribedAt: null },
              data: { transcribedAt: now, skippedAt: now },
            });
            this.logger.warn(
              `Skipped audio chunk ${chunk.id} of meeting ${meetingId}: ${this.redact(err instanceof Error ? err.message : String(err))}`,
            );
            return;
          }
          firstError ??= err;
        }
      });
      if (lost) throw lost;
      if (firstError) throw firstError;
    }
    const remaining = await db.meetingAudioChunk.count({
      where: { meetingId, transcribedAt: null, deletedAt: null },
    });
    if (remaining > 0) throw new Error('Vẫn còn đoạn âm thanh chưa chép lời');
  }

  private async transcribeChunk(
    meetingId: string,
    workspaceId: string,
    chunk: {
      id: string;
      userId: string;
      container: string;
      key: string;
      startOffsetMs: number;
      durationMs: number;
    },
    stt: SpeechToText,
  ): Promise<void> {
    const db = this.prisma.client;
    const { body } = await this.store.getStream({ container: chunk.container, key: chunk.key });
    const audio = await readAll(body);
    const segments = await stt.transcribe(
      { body: audio, mime: 'audio/ogg', durationMs: chunk.durationMs },
      { keyterms: this.config.MEETING_KEYTERMS },
    );
    await db.$transaction(async (tx) => {
      const { count } = await tx.meetingAudioChunk.updateMany({
        where: { id: chunk.id, transcribedAt: null },
        data: { transcribedAt: new Date() },
      });
      if (count === 0) return;
      if (segments.length > 0) {
        await tx.meetingUtterance.createMany({
          data: segments.map((seg) => ({
            meetingId,
            chunkId: chunk.id,
            userId: chunk.userId,
            startMs: chunk.startOffsetMs + seg.startMs,
            endMs: chunk.startOffsetMs + seg.endMs,
            text: seg.text,
          })),
        });
      }
      await tx.meetingAiUsage.create({
        data: {
          meetingId,
          workspaceId,
          kind: 'stt',
          provider: stt.provider,
          model: stt.model,
          audioMs: chunk.durationMs,
          costMicroUsd: sttCostMicroUsd(chunk.durationMs, this.config.MEETING_STT_USD_PER_MIN),
        },
      });
    });
  }

  private async purgeChunks(
    meetingId: string,
    opts: { onlyTranscribed: boolean },
  ): Promise<number> {
    const db = this.prisma.client;
    const chunks = await db.meetingAudioChunk.findMany({
      where: {
        meetingId,
        deletedAt: null,
        ...(opts.onlyTranscribed ? { transcribedAt: { not: null }, skippedAt: null } : {}),
      },
      select: { id: true, container: true, key: true },
    });
    let failed = 0;
    for (const chunk of chunks) {
      try {
        await this.store.delete({ container: chunk.container, key: chunk.key });
        await db.meetingAudioChunk.update({
          where: { id: chunk.id },
          data: { deletedAt: new Date() },
        });
      } catch (err) {
        failed++;
        this.logger.error({ err, chunkId: chunk.id }, 'Deleting a meeting audio object failed');
      }
    }
    const left = await db.meetingAudioChunk.count({ where: { meetingId, deletedAt: null } });
    if (left === 0) {
      await db.meetingMinutes.updateMany({
        where: { meetingId, audioPurgedAt: null },
        data: { audioPurgedAt: new Date() },
      });
    }
    return failed;
  }

  private async buildDraft(
    meeting: {
      id: string;
      workspaceId: string;
      title: string;
      startedAt: Date | null;
      endedAt: Date | null;
      createdAt: Date;
      createdById: string;
      createdBy: { id: string; name: string };
    },
    warnings: Set<string>,
    jobId: string,
    writer: MinutesWriter,
  ) {
    const db = this.prisma.client;
    const [utterances, chat, attendances, invites, workspace, members] = await Promise.all([
      db.meetingUtterance.findMany({
        where: { meetingId: meeting.id },
        orderBy: { startMs: 'asc' },
        select: { userId: true, startMs: true, endMs: true, text: true },
      }),
      db.meetingChatMessage.findMany({
        where: { meetingId: meeting.id },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, body: true, createdAt: true },
      }),
      db.meetingAttendance.findMany({
        where: { meetingId: meeting.id },
        select: { userId: true },
      }),
      db.meetingInvite.findMany({ where: { meetingId: meeting.id }, select: { userId: true } }),
      db.workspace.findUnique({ where: { id: meeting.workspaceId }, select: { kind: true } }),
      db.workspaceMember.findMany({
        where: { workspaceId: meeting.workspaceId, user: { status: 'ACTIVE' } },
        select: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    const attendeeIds = [...new Set(attendances.map((a) => a.userId))];
    const attendeeSet = new Set(attendeeIds);
    const absentIds = new Set<string>(invites.map((i) => i.userId));
    if (workspace?.kind === 'TEAM') for (const m of members) absentIds.add(m.user.id);
    for (const id of absentIds) {
      if (attendeeSet.has(id) || id === meeting.createdById) absentIds.delete(id);
    }

    const involved = new Set<string>([
      ...utterances.map((u) => u.userId),
      ...chat.map((c) => c.userId),
      ...attendeeIds,
    ]);
    const [users, absentUsers] = await Promise.all([
      db.user.findMany({
        where: { id: { in: [...involved] } },
        select: { id: true, name: true },
      }),
      db.user.findMany({
        where: { id: { in: [...absentIds] }, status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(users.map((u) => [u.id, u.name]));

    const startedAt = meeting.startedAt ?? meeting.createdAt;
    const endedAt = meeting.endedAt ?? startedAt;
    const timeline = buildTimeline({ utterances, chat, meetingStartedAt: startedAt, names });
    const hasSpeech = timeline.entries.some((e) => e.kind === 'speech');

    const chatRefs = timeline.entries.filter((e) => e.kind === 'chat').map((e) => e.refId);
    let rawDraft: MinutesDraft = { ...EMPTY_DRAFT, notableChat: chatRefs.slice(0, 100) };
    let promptRefs = new Set<string>(chatRefs.slice(0, 100));
    if (hasSpeech) {
      const limited = limitTimeline(timeline, MAX_TIMELINE_CHARS);
      if (limited.truncated) {
        warnings.add('bản ghi quá dài nên AI chỉ đọc phần đầu và phần cuối');
      }
      promptRefs = new Set(limited.entries.map((e) => e.refId));
      const result = await writer.write({
        system: `${MINUTES_SYSTEM_PROMPT}\n${MINUTES_OUTPUT_RULES}`,
        user: buildMinutesUserMessage({
          title: meeting.title,
          meetingDate: startedAt.toLocaleDateString('en-CA', { timeZone: TIME_ZONE }),
          speakers: timeline.speakers,
          timeline: limited.text,
        }),
      });
      rawDraft = result.draft;
      await db.meetingAiUsage.create({
        data: {
          meetingId: meeting.id,
          workspaceId: meeting.workspaceId,
          kind: 'llm',
          provider: writer.provider,
          model: writer.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costMicroUsd: llmCostMicroUsd(
            result.inputTokens,
            result.outputTokens,
            this.config.MEETING_LLM_USD_PER_MTOK_IN,
            this.config.MEETING_LLM_USD_PER_MTOK_OUT,
          ),
        },
      });
    }

    const { draft, droppedItemCount } = validateDraft(rawDraft, promptRefs, timeline.speakers);

    const candidates = members.map((m) => m.user);
    const speakerIds = new Set(timeline.speakers.map((sp) => sp.userId));
    const suggestions: MentionSuggestion[] = [];
    draft.actionItems.forEach((item, actionIndex) => {
      if (item.ambiguous || item.ownerSpeakerId !== null || !item.ownerName) return;
      const userId = matchPerson(item.ownerName, candidates, speakerIds);
      const person = userId ? candidates.find((c) => c.id === userId) : undefined;
      if (userId && person) {
        suggestions.push({ actionIndex, name: item.ownerName, userId, userName: person.name });
      }
    });

    const doc = renderMinutesDoc({
      title: meeting.title,
      startedAt,
      endedAt,
      hostName: meeting.createdBy.name,
      attendeeCount: attendeeIds.length,
      attendeeIds,
      absentees: absentUsers.map((u) => u.name),
      droppedItemCount,
      draft,
      speakers: timeline.speakers,
      entries: timeline.entries,
      suggestions,
      timeZone: TIME_ZONE,
    });

    const committed = await db.$transaction(async (tx) => {
      const { count } = await tx.meetingMinutes.updateMany({
        where: { meetingId: meeting.id, status: 'PROCESSING', claimedBy: jobId },
        data: {
          status: 'AWAITING_REVIEW',
          draft: draft as unknown as Prisma.InputJsonValue,
          draftDoc: doc as unknown as Prisma.InputJsonValue,
          suggestions: suggestions as unknown as Prisma.InputJsonValue,
          droppedItemCount,
          draftRevision: 1,
          failedStage: null,
          error: joinWarnings(warnings),
        },
      });
      if (count === 0) return false;
      await writeAudit(tx, {
        actorId: null,
        action: 'meeting.minutes_draft',
        targetType: 'meeting',
        targetId: meeting.id,
        workspaceId: meeting.workspaceId,
        metadata: {
          meetingId: meeting.id,
          actionItems: draft.actionItems.length,
          dropped: droppedItemCount,
          provider: writer.provider,
          model: writer.model,
        },
      });
      return true;
    });
    if (!committed) throw new ClaimLost();
    await this.notify([meeting.createdById], 'meeting.minutes_review', {
      meetingId: meeting.id,
      workspaceId: meeting.workspaceId,
      title: meeting.title,
    });
    return { status: 'AWAITING_REVIEW', actionItems: draft.actionItems.length };
  }

  async purgeAudio(): Promise<{ meetings: number; failed: number }> {
    const db = this.prisma.client;
    let meetings = 0;
    let failed = 0;
    let after: string | undefined;
    for (;;) {
      const due = await db.meetingMinutes.findMany({
        where: {
          audioPurgeAfter: { lt: new Date() },
          audioPurgedAt: null,
          ...(after ? { meetingId: { gt: after } } : {}),
        },
        orderBy: { meetingId: 'asc' },
        take: PURGE_BATCH,
        select: { meetingId: true },
      });
      if (due.length === 0) break;
      after = due[due.length - 1]!.meetingId;
      for (const m of due) {
        const bad = await this.purgeChunks(m.meetingId, { onlyTranscribed: false });
        meetings++;
        failed += bad;
      }
      if (due.length < PURGE_BATCH) break;
    }
    if (meetings > 0) this.logger.log(`Purged expired audio for ${meetings} meeting(s)`);
    return { meetings, failed };
  }
}
