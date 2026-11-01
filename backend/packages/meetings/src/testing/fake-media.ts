import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  JoinTokenInput,
  MediaEvent,
  MediaParticipant,
  MeetingMedia,
} from '../media/meeting-media.js';

const FAKE_SECRET = 'fake-meeting-media-webhook-secret';

interface WireEvent {
  kind: string;
  roomName?: string;
  identity?: string;
  eventId: string;
  at: string;
}

function sign(body: string): string {
  return createHmac('sha256', FAKE_SECRET).update(body).digest('hex');
}

export class FakeMeetingMedia implements MeetingMedia {
  readonly serverUrl = 'ws://fake-livekit.test';
  readonly rooms = new Map<string, { metadata: string; participants: MediaParticipant[] }>();
  readonly ended: string[] = [];
  readonly muted: Array<{ roomName: string; identity: string }> = [];
  readonly broadcasts: Array<{ roomName: string; topic: string; payload: unknown }> = [];
  readonly tokens: JoinTokenInput[] = [];
  private readonly failures = new Map<keyof MeetingMedia, Error>();

  failNext(method: keyof MeetingMedia, err: Error): void {
    this.failures.set(method, err);
  }

  private check(method: keyof MeetingMedia): void {
    const err = this.failures.get(method);
    if (err) {
      this.failures.delete(method);
      throw err;
    }
  }

  async ensureRoom(roomName: string, metadata: string): Promise<void> {
    this.check('ensureRoom');
    if (!this.rooms.has(roomName)) this.rooms.set(roomName, { metadata, participants: [] });
  }

  async joinToken(input: JoinTokenInput): Promise<string> {
    this.check('joinToken');
    this.tokens.push(input);
    return `fake-token:${input.roomName}:${input.identity}:${input.role}`;
  }

  async endRoom(roomName: string): Promise<void> {
    this.check('endRoom');
    this.ended.push(roomName);
    this.rooms.delete(roomName);
  }

  async muteMicrophone(roomName: string, identity: string): Promise<boolean> {
    this.check('muteMicrophone');
    const present =
      this.rooms.get(roomName)?.participants.some((p) => p.identity === identity) ?? false;
    if (present) this.muted.push({ roomName, identity });
    return present;
  }

  async setRoomMetadata(roomName: string, metadata: string): Promise<void> {
    this.check('setRoomMetadata');
    const room = this.rooms.get(roomName);
    if (room) room.metadata = metadata;
  }

  async broadcast(roomName: string, topic: string, payload: unknown): Promise<void> {
    this.check('broadcast');
    this.broadcasts.push({ roomName, topic, payload });
  }

  async listParticipants(roomName: string): Promise<MediaParticipant[] | null> {
    this.check('listParticipants');
    const room = this.rooms.get(roomName);
    return room ? [...room.participants] : null;
  }

  async parseWebhook(
    rawBody: string,
    authorization: string | undefined,
  ): Promise<MediaEvent | null> {
    this.check('parseWebhook');
    if (!authorization) return null;
    const expected = Buffer.from(sign(rawBody));
    const given = Buffer.from(authorization);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let wire: WireEvent;
    try {
      wire = JSON.parse(rawBody) as WireEvent;
    } catch {
      return null;
    }
    const at = new Date(wire.at);
    if (wire.kind === 'participant_joined' || wire.kind === 'participant_left') {
      return {
        kind: wire.kind,
        roomName: wire.roomName ?? '',
        identity: wire.identity ?? '',
        eventId: wire.eventId,
        at,
      };
    }
    if (wire.kind === 'room_started' || wire.kind === 'room_finished') {
      return { kind: wire.kind, roomName: wire.roomName ?? '', eventId: wire.eventId, at };
    }
    return { kind: 'ignored', eventId: wire.eventId };
  }

  signWebhook(event: MediaEvent): { body: string; authorization: string } {
    const wire: WireEvent =
      event.kind === 'ignored'
        ? { kind: 'track_published', eventId: event.eventId, at: new Date().toISOString() }
        : {
            kind: event.kind,
            roomName: event.roomName,
            eventId: event.eventId,
            at: event.at.toISOString(),
            ...('identity' in event ? { identity: event.identity } : {}),
          };
    const body = JSON.stringify(wire);
    return { body, authorization: sign(body) };
  }
}
