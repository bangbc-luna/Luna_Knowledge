import type { JobsOptions } from 'bullmq';

export interface ProcessUploadJob {
  uploadId: string;
}
export interface TranscodeJob {
  nodeId: string;
  versionId: string;
}
export interface RegenerateJob {
  nodeId: string;
  versionId: string;
}

type Empty = Record<string, never>;

export interface JobPayloads {
  'file-process': { 'process-upload': ProcessUploadJob; regenerate: RegenerateJob };
  'video-transcode': { transcode: TranscodeJob };
  'search-index': {
    'index-node': { nodeId: string };
    'index-tree': { nodeId: string };
    'drop-workspace': { workspaceId: string };
    'reindex-all': Empty;
  };
  maintenance: {
    'purge-trash': Empty;
    retention: Empty;
    'clean-uploads': Empty;
    'blob-gc': Empty;
  };
  meetings: { remind: { meetingId: string; scheduledAt: string }; reconcile: Empty };
  'meeting-recorder': { record: { meetingId: string } };
  'meeting-minutes': { process: { meetingId: string }; 'purge-audio': Empty };
  system: { ping: Empty };
}

export type JobQueueName = keyof JobPayloads;
export type JobName<Q extends JobQueueName> = keyof JobPayloads[Q] & string;

export type QueueJob<Q extends JobQueueName> = {
  [N in JobName<Q>]: { name: N; data: JobPayloads[Q][N] };
}[JobName<Q>];

export interface JobQueue<Q extends JobQueueName> {
  add<N extends JobName<Q>>(name: N, data: JobPayloads[Q][N], opts?: JobsOptions): Promise<unknown>;
  addBulk(
    jobs: Array<
      {
        [N in JobName<Q>]: { name: N; data: JobPayloads[Q][N]; opts?: JobsOptions };
      }[JobName<Q>]
    >,
  ): Promise<unknown>;
}

export function unknownJob(job: never): string {
  return typeof job === 'string' ? job : (job as { name: string }).name;
}

export const SEARCH_JOB_OPTS = { removeOnComplete: true, removeOnFail: 100 } as const;

export const FILE_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export function transcodePriority(sizeBytes: number | bigint): number {
  return Math.min(1000, 1 + Math.floor(Number(sizeBytes) / (50 * 1024 * 1024)));
}

export function transcodeJobOptions(sizeBytes: number | bigint, jobId?: string) {
  return {
    ...(jobId ? { jobId } : {}),
    priority: transcodePriority(sizeBytes),
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  };
}

export async function enqueueIndexNode(
  queue: JobQueue<'search-index'>,
  nodeId: string,
  opts?: { debounceMs?: number },
): Promise<void> {
  const debounceMs = opts?.debounceMs;
  await queue.add(
    'index-node',
    { nodeId },
    debounceMs === undefined
      ? { ...SEARCH_JOB_OPTS }
      : {
          delay: debounceMs,
          deduplication: { id: `index-node-${nodeId}`, ttl: debounceMs },
          ...SEARCH_JOB_OPTS,
        },
  );
}

export async function enqueueFileJob<N extends JobName<'file-process'>>(
  queue: JobQueue<'file-process'>,
  name: N,
  data: JobPayloads['file-process'][N],
  jobId?: string,
): Promise<void> {
  await queue.add(name, data, { ...(jobId ? { jobId } : {}), ...FILE_JOB_OPTS });
}

export async function enqueueTranscode(
  queue: JobQueue<'video-transcode'>,
  job: TranscodeJob,
  sizeBytes: number | bigint,
  jobId?: string,
): Promise<void> {
  await queue.add('transcode', job, transcodeJobOptions(sizeBytes, jobId));
}

export const MEETING_REMINDER_MIN_LEAD_MS = 60_000;

export async function enqueueMeetingReminder(
  queue: JobQueue<'meetings'>,
  meetingId: string,
  scheduledAt: Date,
  reminderMinutes: number,
): Promise<void> {
  const now = Date.now();
  const at = scheduledAt.getTime();
  if (at - now < MEETING_REMINDER_MIN_LEAD_MS) return;
  await queue.add(
    'remind',
    { meetingId, scheduledAt: scheduledAt.toISOString() },
    {
      jobId: `remind-${meetingId}-${at}`,
      delay: Math.max(0, at - reminderMinutes * 60_000 - now),
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

export const RECORDER_BACKOFF_BASE_MS = 5000;
export const RECORDER_BACKOFF_CAP_MS = 600_000;

export function recorderBackoffMs(attemptsMade: number): number {
  return Math.min(
    RECORDER_BACKOFF_CAP_MS,
    RECORDER_BACKOFF_BASE_MS * 2 ** Math.max(0, attemptsMade - 1),
  );
}

export const RECORDER_JOB_OPTS = {
  attempts: 12,
  backoff: { type: 'custom' as const },
  removeOnComplete: true,
  removeOnFail: 50,
};

const REMOVABLE_RECORDER_STATES = new Set(['failed', 'completed']);

export async function enqueueRecording(
  queue: JobQueue<'meeting-recorder'> & {
    getJob(
      id: string,
    ): Promise<{ getState(): Promise<string>; remove(): Promise<void> } | undefined>;
  },
  meetingId: string,
): Promise<void> {
  const jobId = `record-${meetingId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    if (!REMOVABLE_RECORDER_STATES.has(await existing.getState())) return;
    await existing.remove();
  }
  await queue.add('record', { meetingId }, { jobId, ...RECORDER_JOB_OPTS });
}

export async function enqueueMinutes(
  queue: JobQueue<'meeting-minutes'>,
  meetingId: string,
  opts: { delayMs?: number; attempt?: number } = {},
): Promise<void> {
  await queue.add(
    'process',
    { meetingId },
    {
      jobId: opts.attempt ? `minutes-${meetingId}-retry-${opts.attempt}` : `minutes-${meetingId}`,
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
      attempts: 4,
      backoff: { type: 'exponential' as const, delay: 60_000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );
}

export async function promoteMinutes(
  queue: JobQueue<'meeting-minutes'> & {
    getJob(
      id: string,
    ): Promise<{ isDelayed(): Promise<boolean>; promote(): Promise<void> } | undefined>;
  },
  meetingId: string,
): Promise<void> {
  const job = await queue.getJob(`minutes-${meetingId}`);
  if (!job) {
    await enqueueMinutes(queue, meetingId);
    return;
  }
  if (await job.isDelayed()) await job.promote();
}
