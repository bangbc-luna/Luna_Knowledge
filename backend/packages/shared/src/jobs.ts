import type { JobsOptions } from 'bullmq';
import type { QUEUES } from './constants.js';
import type { SEARCH_JOBS } from './search.js';

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

type _QueueNames = (typeof QUEUES)[keyof typeof QUEUES];
type _SearchJobNames = (typeof SEARCH_JOBS)[keyof typeof SEARCH_JOBS];
type _Assert<T extends true> = T;
export type _JobKeysMatchConstants = _Assert<
  Exclude<JobQueueName, _QueueNames> extends never ? true : false
> &
  _Assert<Exclude<_SearchJobNames, JobName<'search-index'>> extends never ? true : false>;

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
