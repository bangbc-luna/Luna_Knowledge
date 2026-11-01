import { createHash } from 'node:crypto';
import { AccessToken, ServerError } from 'livekit-server-sdk';
import { describe, expect, it, vi } from 'vitest';
import { LiveKitMeetingMedia } from './livekit-media.js';

const env = {
  LIVEKIT_URL: 'wss://luna.livekit.test',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'a-secret-that-is-at-least-32-characters',
  MEETING_TOKEN_TTL_SEC: 600,
  MEETING_EMPTY_GRACE_SEC: 120,
  MEETING_MAX_PARTICIPANTS: 25,
};

interface Claims {
  sub: string;
  nbf: number;
  exp: number;
  video: Record<string, unknown>;
}

function decodeJwt(jwt: string): Claims {
  return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as Claims;
}

async function signedWebhook(payload: object, secret = env.LIVEKIT_API_SECRET) {
  const body = JSON.stringify(payload);
  const token = new AccessToken(env.LIVEKIT_API_KEY, secret);
  token.sha256 = createHash('sha256').update(body).digest('base64');
  return { body, authorization: await token.toJwt() };
}

describe('LiveKitMeetingMedia', () => {
  const media = new LiveKitMeetingMedia(env);

  it('exposes the websocket url', () => {
    expect(media.serverUrl).toBe('wss://luna.livekit.test');
  });

  it('participant token: right room, publishes mic/camera/screen, no roomAdmin, expires after 600 seconds', async () => {
    const jwt = await media.joinToken({
      roomName: 'luna-m1',
      identity: 'u1',
      name: 'Lan',
      role: 'participant',
    });
    const claims = decodeJwt(jwt);
    expect(claims.sub).toBe('u1');
    expect(claims.exp - claims.nbf).toBe(600);
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: 'luna-m1',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
      canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
    });
    expect(claims.video.roomAdmin).toBeUndefined();
  });

  it('host token has the same grant as a participant', async () => {
    const host = decodeJwt(
      await media.joinToken({ roomName: 'luna-m1', identity: 'h', name: 'H', role: 'host' }),
    );
    expect(host.video.roomAdmin).toBeUndefined();
    expect(host.video.canPublish).toBe(true);
  });

  it('recorder token: hidden, subscribe only, no publish', async () => {
    const claims = decodeJwt(
      await media.joinToken({
        roomName: 'luna-m1',
        identity: 'luna-recorder',
        name: 'Luna AI',
        role: 'recorder',
      }),
    );
    expect(claims.video).toMatchObject({
      roomJoin: true,
      hidden: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
    });
  });

  it('webhook: valid signature gives a normalised event; bad signature or missing header gives null', async () => {
    const started = await signedWebhook({
      event: 'room_started',
      id: 'EV_1',
      createdAt: 1700000000,
      room: { name: 'luna-m1' },
    });
    await expect(media.parseWebhook(started.body, started.authorization)).resolves.toEqual({
      kind: 'room_started',
      roomName: 'luna-m1',
      eventId: 'EV_1',
      at: new Date(1700000000 * 1000),
    });
    const joined = await signedWebhook({
      event: 'participant_joined',
      id: 'EV_2',
      createdAt: 1700000001,
      room: { name: 'luna-m1' },
      participant: { identity: 'u1' },
    });
    await expect(media.parseWebhook(joined.body, joined.authorization)).resolves.toMatchObject({
      kind: 'participant_joined',
      identity: 'u1',
      eventId: 'EV_2',
    });
    const forged = await signedWebhook(
      { event: 'room_finished', id: 'EV_3', room: { name: 'luna-m1' } },
      'another-secret-that-is-32-characters!!',
    );
    await expect(media.parseWebhook(forged.body, forged.authorization)).resolves.toBeNull();
    await expect(media.parseWebhook(started.body, undefined)).resolves.toBeNull();
  });

  it('webhook: unmapped events give null', async () => {
    const other = await signedWebhook({
      event: 'track_published',
      id: 'EV_4',
      room: { name: 'luna-m1' },
    });
    await expect(media.parseWebhook(other.body, other.authorization)).resolves.toBeNull();
  });

  describe('not-found handling', () => {
    const notFound = () => new ServerError('not_found', 'gone', 404, 'not_found');
    const boom = () => new ServerError('internal', 'boom', 500, 'internal');

    function withClient(client: Record<string, unknown>) {
      const m = new LiveKitMeetingMedia(env);
      (m as unknown as { rooms: unknown }).rooms = client;
      return m;
    }

    it('muteMicrophone returns false when the participant or room is not found, rethrows others', async () => {
      const missing = withClient({ getParticipant: vi.fn().mockRejectedValue(notFound()) });
      await expect(missing.muteMicrophone('r', 'u')).resolves.toBe(false);
      const broken = withClient({ getParticipant: vi.fn().mockRejectedValue(boom()) });
      await expect(broken.muteMicrophone('r', 'u')).rejects.toThrow('boom');
    });

    it('endRoom returns normally when the room is not found, rethrows others', async () => {
      await expect(
        withClient({ deleteRoom: vi.fn().mockRejectedValue(notFound()) }).endRoom('r'),
      ).resolves.toBeUndefined();
      await expect(
        withClient({ deleteRoom: vi.fn().mockRejectedValue(boom()) }).endRoom('r'),
      ).rejects.toThrow('boom');
    });

    it('setRoomMetadata swallows not-found, rethrows others', async () => {
      await expect(
        withClient({ updateRoomMetadata: vi.fn().mockRejectedValue(notFound()) }).setRoomMetadata(
          'r',
          '{}',
        ),
      ).resolves.toBeUndefined();
      await expect(
        withClient({ updateRoomMetadata: vi.fn().mockRejectedValue(boom()) }).setRoomMetadata(
          'r',
          '{}',
        ),
      ).rejects.toThrow('boom');
    });

    it('webhook without createdAt falls back to now', async () => {
      const before = Date.now();
      const w = await signedWebhook({
        event: 'room_started',
        id: 'EV_9',
        room: { name: 'luna-m1' },
      });
      const ev = await media.parseWebhook(w.body, w.authorization);
      expect(ev!.at.getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});
