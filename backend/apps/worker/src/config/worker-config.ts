import {
  baseEnvSchema,
  databaseEnvSchema,
  loadEnv,
  processingEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
  observabilityEnvSchema,
  optionalEnv,
  searchEnvSchema,
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
  .extend(searchEnvSchema.shape)
  .extend(observabilityEnvSchema.shape)
  .extend({
    FILE_PROCESS_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    WORKER_TMP_DIR: optionalEnv(z.string()),
    WORKER_METRICS_PORT: z.coerce.number().int().min(0).default(9464),
    WORKSPACE_PURGE_DAYS: z.coerce.number().int().min(1).default(30),
    AUTO_VERSION_THIN_DAYS: z.coerce.number().int().min(1).default(30),
  });

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');

export function loadWorkerConfig(source?: NodeJS.ProcessEnv): WorkerConfig {
  return loadEnv(workerEnvSchema, source);
}

export { redisConnection } from '@luna/shared';
