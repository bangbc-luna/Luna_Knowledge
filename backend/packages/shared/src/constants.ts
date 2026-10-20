/** Tên hàng đợi BullMQ dùng chung giữa API và worker. */
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

/** Kênh Redis pub/sub báo trạng thái xử lý của một node (SSE `/nodes/:id/events`). */
export const nodeEventsChannel = (nodeId: string) => `node-events:${nodeId}`;
export const NODE_EVENTS_PATTERN = 'node-events:*';

/** Job trong hàng đợi file-process / maintenance dùng chung giữa API và worker. */
export const JOBS = {
  PROCESS_UPLOAD: 'process-upload',
  REGENERATE: 'regenerate',
  PURGE_TRASH: 'purge-trash',
  CLEAN_UPLOADS: 'clean-uploads',
  BLOB_GC: 'blob-gc',
} as const;

export interface ProcessUploadJob {
  uploadId: string;
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
}
