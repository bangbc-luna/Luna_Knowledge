import type { Redis } from 'ioredis';

export const playbackKey = (token: string) => `pb:${token}`;
export const playbackIndexKey = (sessionId: string) => `pbs:${sessionId}`;

export async function revokePlaybackSessions(redis: Redis, sessionIds: string[]): Promise<void> {
  for (const sessionId of sessionIds) {
    const index = playbackIndexKey(sessionId);
    const tokens = await redis.smembers(index);
    await redis.del(...tokens.map(playbackKey), index);
  }
}
