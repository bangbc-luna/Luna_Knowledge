export type MediaRole = 'host' | 'participant' | 'recorder';

export interface JoinTokenInput {
  roomName: string;
  identity: string;
  name: string;
  role: MediaRole;
  metadata?: string;
}

export type MediaEvent =
  | { kind: 'ignored'; eventId: string }
  | { kind: 'room_started' | 'room_finished'; roomName: string; eventId: string; at: Date }
  | {
      kind: 'participant_joined' | 'participant_left';
      roomName: string;
      identity: string;
      eventId: string;
      at: Date;
    };

export interface MediaParticipant {
  identity: string;
  joinedAt: Date;
  hidden: boolean;
}

export interface MeetingMedia {
  readonly serverUrl: string;
  ensureRoom(roomName: string, metadata: string): Promise<void>;
  joinToken(input: JoinTokenInput): Promise<string>;
  endRoom(roomName: string): Promise<void>;
  muteMicrophone(roomName: string, identity: string): Promise<boolean>;
  setParticipantAttributes(
    roomName: string,
    identity: string,
    attributes: Record<string, string>,
  ): Promise<boolean>;
  setRoomMetadata(roomName: string, metadata: string): Promise<void>;
  broadcast(roomName: string, topic: string, payload: unknown): Promise<void>;
  listParticipants(roomName: string): Promise<MediaParticipant[] | null>;
  parseWebhook(rawBody: string, authorization: string | undefined): Promise<MediaEvent | null>;
}

export const MEETING_MEDIA = Symbol('MEETING_MEDIA');

export interface RoomMetadata {
  title: string;
  aiNotesEnabled: boolean;
  hostId: string;
  version?: number;
}

export function encodeRoomMetadata(m: RoomMetadata): string {
  return JSON.stringify({
    title: m.title,
    aiNotesEnabled: m.aiNotesEnabled,
    hostId: m.hostId,
    ...(m.version === undefined ? {} : { version: m.version }),
  });
}

export function decodeRoomMetadata(s: string): RoomMetadata | null {
  try {
    const v: unknown = JSON.parse(s);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (
      typeof o.title !== 'string' ||
      typeof o.aiNotesEnabled !== 'boolean' ||
      typeof o.hostId !== 'string'
    ) {
      return null;
    }
    const decoded: RoomMetadata = {
      title: o.title,
      aiNotesEnabled: o.aiNotesEnabled,
      hostId: o.hostId,
    };
    if (typeof o.version === 'number' && Number.isInteger(o.version)) decoded.version = o.version;
    return decoded;
  } catch {
    return null;
  }
}
