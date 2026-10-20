import { baseEnvSchema, loadEnv } from '@luna/shared';
import { z } from 'zod';

// Phase 5 bổ sung DATABASE_URL, REDIS_URL, secret xác thực collab token.
export const collabEnvSchema = baseEnvSchema.extend({
  COLLAB_PORT: z.coerce.number().int().nonnegative().default(4001),
});

export type CollabConfig = z.output<typeof collabEnvSchema>;

export function loadCollabConfig(source?: NodeJS.ProcessEnv): CollabConfig {
  return loadEnv(collabEnvSchema, source);
}
