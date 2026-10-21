import {
  baseEnvSchema,
  databaseEnvSchema,
  loadEnv,
  processingEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
  uploadEnvSchema,
  videoEnvSchema,
} from '@luna/shared';
import { z } from 'zod';

// Các phase sau sẽ bổ sung searchEnvSchema…
export const workerEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(s3EnvSchema.shape)
  .extend(processingEnvSchema.shape)
  .extend(uploadEnvSchema.shape)
  .extend(videoEnvSchema.shape)
  .extend({
    /** Số file xử lý song song (Gotenberg/sharp tốn CPU). */
    FILE_PROCESS_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    /**
     * Thư mục làm việc tạm (tải file gốc về, đầu ra ffmpeg). Video 1 giờ cần vài GB: đặt trên đĩa,
     * đừng để trên tmpfs (RAM). Mặc định là thư mục tạm của hệ điều hành.
     */
    WORKER_TMP_DIR: z.string().optional(),
  });

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');

export function loadWorkerConfig(source?: NodeJS.ProcessEnv): WorkerConfig {
  return loadEnv(workerEnvSchema, source);
}

export { redisConnection } from '@luna/shared';
