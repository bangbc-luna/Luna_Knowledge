export const QUEUES = {
  SYSTEM: 'system',
  AUDIT: 'audit',
  FILE_PROCESS: 'file-process',
  VIDEO_TRANSCODE: 'video-transcode',
  SEARCH_INDEX: 'search-index',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const BUCKET_KEYS = ['tmp', 'hls', 'previews', 'thumbnails', 'assets', 'originals'] as const;
export type BucketKey = (typeof BUCKET_KEYS)[number];

export const nodeEventsChannel = (nodeId: string) => `node-events:${nodeId}`;
export const NODE_EVENTS_PATTERN = 'node-events:*';

export const JOBS = {
  PROCESS_UPLOAD: 'process-upload',
  REGENERATE: 'regenerate',
  PURGE_TRASH: 'purge-trash',
  CLEAN_UPLOADS: 'clean-uploads',
  BLOB_GC: 'blob-gc',
  RETENTION: 'retention',
  TRANSCODE: 'transcode',
} as const;

export interface ProcessUploadJob {
  uploadId: string;
}
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

export interface TranscodeJob {
  nodeId: string;
  versionId: string;
}
export interface RegenerateJob {
  nodeId: string;
  versionId: string;
}

export interface NodeEvent {
  nodeId: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  versionId?: string;
  error?: string;
  progress?: number;
}

export const COLLAB_ACCESS_CHANNEL = 'collab:access';
export interface CollabAccessEvent {
  workspaceId?: string;
  userId?: string;
  nodeId?: string;
  sessionId?: string;
}
export const SESSION_REVOKED_CHANNEL = 'luna:session-revoked';
export const collabDocumentName = (nodeId: string) => `doc:${nodeId}`;
export const COLLAB_TOKEN_AUDIENCE = 'luna-collab';

export const notifyChannel = (userId: string) => `notify:${userId}`;
export const NOTIFY_PATTERN = 'notify:*';
