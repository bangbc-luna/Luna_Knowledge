import { meetingsEnvSchema } from '@luna/meetings';
import {
  baseEnvSchema,
  databaseEnvSchema,
  loadEnv,
  observabilityEnvSchema,
  redisEnvSchema,
  s3EnvSchema,
} from '@luna/shared';
import { z } from 'zod';

export const recorderEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(s3EnvSchema.shape)
  .extend(observabilityEnvSchema.shape)
  .extend(meetingsEnvSchema.shape)
  .extend({
    MEETING_RECORDER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
    RECORDER_TMP_DIR: z.string().default('/var/tmp/luna-recorder'),
    RECORDER_METRICS_PORT: z.coerce.number().int().min(0).default(9465),
    FFMPEG_PATH: z.string().default('ffmpeg'),
    FFMPEG_NICE: z.coerce.number().int().min(0).max(19).default(10),
    MEETING_AUDIO_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  });

export type RecorderConfig = z.output<typeof recorderEnvSchema>;

export const RECORDER_CONFIG = Symbol('RECORDER_CONFIG');

export function loadRecorderConfig(source?: NodeJS.ProcessEnv): RecorderConfig {
  return loadEnv(recorderEnvSchema, source);
}

export { redisConnection } from '@luna/shared';
