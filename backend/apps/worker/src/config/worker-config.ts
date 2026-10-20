import {
  baseEnvSchema,
  databaseEnvSchema,
  loadEnv,
  processingEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
  uploadEnvSchema,
} from '@luna/shared';
import { z } from 'zod';

// Các phase sau sẽ bổ sung searchEnvSchema…
export const workerEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(s3EnvSchema.shape)
  .extend(processingEnvSchema.shape)
  .extend(uploadEnvSchema.shape)
  .extend({
    /** Số file xử lý song song (Gotenberg/sharp tốn CPU). */
    FILE_PROCESS_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  });

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');

export function loadWorkerConfig(source?: NodeJS.ProcessEnv): WorkerConfig {
  return loadEnv(workerEnvSchema, source);
}

export { redisConnection } from '@luna/shared';
