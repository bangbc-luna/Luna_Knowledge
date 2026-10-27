import type { z } from 'zod';
import type { baseEnvSchema } from './env.js';

type ListenEnv = Pick<z.output<typeof baseEnvSchema>, 'NODE_ENV' | 'LISTEN_HOST'>;

export function listenHost(env: ListenEnv): string {
  return env.LISTEN_HOST ?? (env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0');
}
