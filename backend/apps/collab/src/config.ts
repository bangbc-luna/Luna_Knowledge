import {
  baseEnvSchema,
  collabSecretsSchema,
  databaseEnvSchema,
  loadEnv,
  redisEnvSchema,
} from '@luna/shared';
import { z } from 'zod';

export const collabEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(collabSecretsSchema.shape)
  .extend({
    COLLAB_PORT: z.coerce.number().int().nonnegative().default(4001),
    COLLAB_AUTO_VERSION_MIN: z.coerce.number().int().positive().default(30),
  });

export type CollabConfig = z.output<typeof collabEnvSchema>;

export function loadCollabConfig(source?: NodeJS.ProcessEnv): CollabConfig {
  return loadEnv(collabEnvSchema, source);
}
