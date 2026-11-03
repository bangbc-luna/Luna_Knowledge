import type { PrismaClient } from '@luna/db';
import { describe, expect, it, vi } from 'vitest';
import { endMeeting } from './lifecycle.js';
import type { MeetingMedia } from './media/meeting-media.js';
import { FakeMeetingMedia } from './testing/fake-media.js';

function stubDb(): PrismaClient {
  const tx = {
    $queryRaw: async () => [
      { id: 'm1', workspace_id: 'w1', ai_notes_enabled: true, ended_at: new Date() },
    ],
    $executeRaw: async () => 0,
    auditLog: { create: async () => ({}) },
  };
  return { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as never;
}

describe('endMeeting side effects', () => {
  it('returns true and still runs onEnded when endRoom rejects', async () => {
    const media = new FakeMeetingMedia();
    media.failNext('endRoom', new Error('livekit down'));
    const onEnded = vi.fn(async () => {});
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(endMeeting({ db: stubDb(), media, onEnded }, 'm1', 'host', 'u1')).resolves.toBe(
      true,
    );
    expect(onEnded).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('returns true and still runs onEnded when endRoom throws synchronously', async () => {
    const media = {
      endRoom: () => {
        throw new Error('sync boom');
      },
    } as unknown as MeetingMedia;
    const onEnded = vi.fn(async () => {});
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(endMeeting({ db: stubDb(), media, onEnded }, 'm1', 'host', null)).resolves.toBe(
      true,
    );
    expect(onEnded).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('returns true and logs when onEnded rejects', async () => {
    const media = new FakeMeetingMedia();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onEnded = vi.fn(async () => {
      throw new Error('hook failed');
    });
    await expect(endMeeting({ db: stubDb(), media, onEnded }, 'm1', 'empty', null)).resolves.toBe(
      true,
    );
    expect(media.ended).toEqual(['luna-m1']);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
