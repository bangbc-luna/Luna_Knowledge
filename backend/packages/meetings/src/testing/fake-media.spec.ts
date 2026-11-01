import { describe, expect, it } from 'vitest';
import { FakeMeetingMedia } from './fake-media.js';

describe('FakeMeetingMedia', () => {
  it('records rooms, tokens, mutes, broadcasts and ends', async () => {
    const media = new FakeMeetingMedia();
    await media.ensureRoom('r1', '{"a":1}');
    await media.ensureRoom('r1', '{"a":2}');
    expect(media.rooms.get('r1')?.metadata).toBe('{"a":1}');
    await media.setRoomMetadata('r1', '{"a":3}');
    expect(media.rooms.get('r1')?.metadata).toBe('{"a":3}');
    const token = await media.joinToken({
      roomName: 'r1',
      identity: 'u1',
      name: 'U',
      role: 'participant',
    });
    expect(typeof token).toBe('string');
    expect(media.tokens).toHaveLength(1);
    await media.broadcast('r1', 'topic', { x: 1 });
    expect(media.broadcasts).toEqual([{ roomName: 'r1', topic: 'topic', payload: { x: 1 } }]);
    await expect(media.listParticipants('missing')).resolves.toBeNull();
    await expect(media.listParticipants('r1')).resolves.toEqual([]);
    await media.endRoom('r1');
    expect(media.ended).toEqual(['r1']);
    expect(media.rooms.has('r1')).toBe(false);
  });

  it('mutes only participants present', async () => {
    const media = new FakeMeetingMedia();
    await media.ensureRoom('r1', '');
    media.rooms
      .get('r1')!
      .participants.push({ identity: 'u1', joinedAt: new Date(), hidden: false });
    await expect(media.muteMicrophone('r1', 'u1')).resolves.toBe(true);
    await expect(media.muteMicrophone('r1', 'nobody')).resolves.toBe(false);
    expect(media.muted).toEqual([{ roomName: 'r1', identity: 'u1' }]);
  });

  it('failNext makes the next call of that method throw once', async () => {
    const media = new FakeMeetingMedia();
    media.failNext('ensureRoom', new Error('boom'));
    await expect(media.ensureRoom('r1', '')).rejects.toThrow('boom');
    await expect(media.ensureRoom('r1', '')).resolves.toBeUndefined();
  });

  it('signWebhook round-trips through parseWebhook and rejects tampering', async () => {
    const media = new FakeMeetingMedia();
    const at = new Date('2026-11-01T10:00:00.000Z');
    const signed = media.signWebhook({
      kind: 'participant_joined',
      roomName: 'r1',
      identity: 'u1',
      eventId: 'e1',
      at,
    });
    await expect(media.parseWebhook(signed.body, signed.authorization)).resolves.toEqual({
      kind: 'participant_joined',
      roomName: 'r1',
      identity: 'u1',
      eventId: 'e1',
      at,
    });
    await expect(media.parseWebhook(signed.body + ' ', signed.authorization)).resolves.toBeNull();
    await expect(media.parseWebhook(signed.body, undefined)).resolves.toBeNull();
  });
});
