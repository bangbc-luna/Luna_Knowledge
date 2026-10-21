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

export const workerEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(s3EnvSchema.shape)
  .extend(processingEnvSchema.shape)
  .extend(uploadEnvSchema.shape)
  .extend(videoEnvSchema.shape)
  .extend({
    FILE_PROCESS_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    WORKER_TMP_DIR: z.string().optional(),
  });

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');

export function loadWorkerConfig(source?: NodeJS.ProcessEnv): WorkerConfig {
  return loadEnv(workerEnvSchema, source);
}

export { redisConnection } from '@luna/shared';
