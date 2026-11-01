import {
  AccessToken,
  DataPacket_Kind,
  RoomServiceClient,
  TrackSource,
  TwirpError,
  WebhookReceiver,
  type VideoGrant,
} from 'livekit-server-sdk';
import type { MeetingsEnv } from '../env.js';
import type {
  JoinTokenInput,
  MediaEvent,
  MediaParticipant,
  MeetingMedia,
} from './meeting-media.js';

type LiveKitEnv = Pick<
  MeetingsEnv,
  | 'LIVEKIT_URL'
  | 'LIVEKIT_API_KEY'
  | 'LIVEKIT_API_SECRET'
  | 'MEETING_TOKEN_TTL_SEC'
  | 'MEETING_EMPTY_GRACE_SEC'
  | 'MEETING_MAX_PARTICIPANTS'
>;

const PUBLISH_SOURCES = [
  TrackSource.CAMERA,
  TrackSource.MICROPHONE,
  TrackSource.SCREEN_SHARE,
  TrackSource.SCREEN_SHARE_AUDIO,
];

const MAPPED_EVENTS = new Set([
  'room_started',
  'room_finished',
  'participant_joined',
  'participant_left',
]);

export class LiveKitMeetingMedia implements MeetingMedia {
  readonly serverUrl: string;
  private readonly rooms: RoomServiceClient;
  private readonly receiver: WebhookReceiver;

  constructor(private readonly env: LiveKitEnv) {
    this.serverUrl = env.LIVEKIT_URL;
    const host = env.LIVEKIT_URL.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    this.rooms = new RoomServiceClient(host, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
    this.receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }

  async ensureRoom(roomName: string, metadata: string): Promise<void> {
    await this.rooms.createRoom({
      name: roomName,
      emptyTimeout: this.env.MEETING_EMPTY_GRACE_SEC,
      departureTimeout: this.env.MEETING_EMPTY_GRACE_SEC,
      maxParticipants: this.env.MEETING_MAX_PARTICIPANTS + 1,
      metadata,
    });
  }

  async joinToken(input: JoinTokenInput): Promise<string> {
    const token = new AccessToken(this.env.LIVEKIT_API_KEY, this.env.LIVEKIT_API_SECRET, {
      identity: input.identity,
      name: input.name,
      ttl: this.env.MEETING_TOKEN_TTL_SEC,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
    const grant: VideoGrant =
      input.role === 'recorder'
        ? {
            roomJoin: true,
            room: input.roomName,
            hidden: true,
            canSubscribe: true,
            canPublish: false,
            canPublishData: false,
          }
        : {
            roomJoin: true,
            room: input.roomName,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
            canUpdateOwnMetadata: true,
            canPublishSources: PUBLISH_SOURCES,
          };
    token.addGrant(grant);
    return token.toJwt();
  }

  async endRoom(roomName: string): Promise<void> {
    await this.rooms.deleteRoom(roomName);
  }

  async muteMicrophone(roomName: string, identity: string): Promise<boolean> {
    const participant = await this.rooms.getParticipant(roomName, identity);
    const mic = participant.tracks.find((t) => t.source === TrackSource.MICROPHONE);
    if (!mic) return false;
    await this.rooms.mutePublishedTrack(roomName, identity, mic.sid, true);
    return true;
  }

  async setRoomMetadata(roomName: string, metadata: string): Promise<void> {
    await this.rooms.updateRoomMetadata(roomName, metadata);
  }

  async broadcast(roomName: string, topic: string, payload: unknown): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    await this.rooms.sendData(roomName, data, DataPacket_Kind.RELIABLE, { topic });
  }

  async listParticipants(roomName: string): Promise<MediaParticipant[] | null> {
    try {
      const list = await this.rooms.listParticipants(roomName);
      return list.map((p) => ({
        identity: p.identity,
        joinedAt: new Date(Number(p.joinedAtMs) || Number(p.joinedAt) * 1000),
        hidden: p.permission?.hidden ?? false,
      }));
    } catch (err) {
      if (err instanceof TwirpError && (err.code === 'not_found' || err.status === 404))
        return null;
      throw err;
    }
  }

  async parseWebhook(
    rawBody: string,
    authorization: string | undefined,
  ): Promise<MediaEvent | null> {
    if (!authorization) return null;
    let event;
    try {
      event = await this.receiver.receive(rawBody, authorization);
    } catch {
      return null;
    }
    if (!MAPPED_EVENTS.has(event.event) || !event.room) return null;
    const at = new Date(Number(event.createdAt) * 1000);
    const base = { roomName: event.room.name, eventId: event.id, at };
    if (event.event === 'room_started' || event.event === 'room_finished') {
      return { kind: event.event, ...base };
    }
    if (!event.participant) return null;
    return {
      kind: event.event as 'participant_joined' | 'participant_left',
      identity: event.participant.identity,
      ...base,
    };
  }
}
