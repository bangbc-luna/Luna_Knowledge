import {
  AudioStream,
  ParticipantKind,
  Room,
  RoomEvent,
  type RemoteTrack,
  TrackKind,
  TrackSource,
} from '@livekit/rtc-node';
import { decodeRoomMetadata, MEETING_MEDIA, type MeetingMedia, roomNameFor } from '@luna/meetings';
import { ObjectStore, promoteMinutes, QUEUES } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { RECORDER_CONFIG, type RecorderConfig } from './config.js';
import { PrismaService } from './prisma.provider.js';
import { type AudioEncoder, OpusEncoder } from './opus-encoder.js';
import { type RecordedFrame, TrackRecorder } from './track-recorder.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORDER_IDENTITY = 'luna-recorder';
const RECORDER_NAME = 'Luna AI';
const DAY_MS = 86_400_000;

export interface PublicationLike {
  readonly kind?: TrackKind;
  readonly source?: TrackSource;
  setSubscribed(subscribed: boolean): void;
}

export interface ParticipantLike {
  readonly identity: string;
  readonly kind: ParticipantKind;
  readonly trackPublications: ReadonlyMap<string, PublicationLike>;
}

export interface RoomLike {
  readonly remoteParticipants: ReadonlyMap<string, ParticipantLike>;
  readonly metadata: string | undefined;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
  disconnect(): Promise<void>;
}

export interface RecorderHooks {
  connectRoom?: (url: string, token: string) => Promise<RoomLike>;
  openAudio?: (track: unknown) => AsyncIterable<RecordedFrame>;
  createEncoder?: () => AudioEncoder;
  now?: () => number;
  pollMs?: number;
}

export const RECORDER_HOOKS = Symbol('RECORDER_HOOKS');

export type RecordingResult = 'ended' | 'disabled' | 'empty';

export class RecordingAborted extends Error {
  override readonly name = 'RecordingAborted';
}

async function connectRealRoom(url: string, token: string): Promise<RoomLike> {
  const room = new Room();
  await room.connect(url, token, { autoSubscribe: false, dynacast: false });
  return room as unknown as RoomLike;
}

function openRealAudio(track: unknown): AsyncIterable<RecordedFrame> {
  return new AudioStream(track as RemoteTrack, { sampleRate: 16000, numChannels: 1 });
}

export function isRecordable(participant: ParticipantLike): boolean {
  return participant.kind === ParticipantKind.STANDARD && UUID.test(participant.identity);
}

export function isMicrophone(publication: PublicationLike): boolean {
  return (
    publication.kind === TrackKind.KIND_AUDIO &&
    publication.source === TrackSource.SOURCE_MICROPHONE
  );
}

@Injectable()
export class RecordingSession {
  private readonly logger = new Logger(RecordingSession.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ObjectStore,
    @InjectQueue(QUEUES.MEETING_MINUTES) private readonly minutesQueue: Queue,
    @Inject(MEETING_MEDIA) private readonly media: MeetingMedia,
    @Inject(RECORDER_CONFIG) private readonly config: RecorderConfig,
    @Optional() @Inject(RECORDER_HOOKS) private readonly hooks: RecorderHooks = {},
  ) {}

  async run(meetingId: string, signal: AbortSignal): Promise<RecordingResult> {
    const db = this.prisma.client;
    const now = this.hooks.now ?? Date.now;
    const meeting = await db.meeting.findUnique({
      where: { id: meetingId },
      select: { status: true, startedAt: true, aiNotesEnabled: true },
    });
    if (meeting?.status !== 'LIVE') {
      const minutes = meeting
        ? await db.meetingMinutes.findUnique({
            where: { meetingId },
            select: { audioCompletedAt: true },
          })
        : null;
      if (!minutes) return 'empty';
      if (!minutes.audioCompletedAt) await this.complete(meetingId);
      return this.resultOf(meetingId, true);
    }
    const startedAt = meeting.startedAt ?? new Date(now());
    await db.meetingMinutes.upsert({
      where: { meetingId },
      create: {
        meetingId,
        status: 'RECORDING',
        audioPurgeAfter: new Date(now() + this.config.MEETING_AUDIO_RETENTION_DAYS * DAY_MS),
      },
      update: {},
    });

    const roomName = roomNameFor(meetingId);
    const token = await this.media.joinToken({
      roomName,
      identity: RECORDER_IDENTITY,
      name: RECORDER_NAME,
      role: 'recorder',
    });
    const room = await (this.hooks.connectRoom ?? connectRealRoom)(this.media.serverUrl, token);
    const openAudio = this.hooks.openAudio ?? openRealAudio;
    const createEncoder =
      this.hooks.createEncoder ??
      (() =>
        new OpusEncoder({ ffmpegPath: this.config.FFMPEG_PATH, nice: this.config.FFMPEG_NICE }));

    const recorders = new Map<string, TrackRecorder>();
    const subscribed = new WeakSet<PublicationLike>();
    const consumers = new Set<Promise<void>>();
    let dbEnabled = meeting.aiNotesEnabled;
    let metaEnabled = decodeRoomMetadata(room.metadata ?? '')?.aiNotesEnabled ?? false;
    let everEnabled = false;
    let disconnected = false;
    let emptySince: number | null = null;
    let wakeRequested = false;
    let wake: () => void = () => undefined;

    const enabled = () => dbEnabled && metaEnabled;
    const requestWake = () => {
      wakeRequested = true;
      wake();
    };
    const applyEnabled = async () => {
      const on = enabled();
      if (on) everEnabled = true;
      await Promise.all(
        [...recorders.values()].map(async (r) => {
          if (on) r.resume();
          else await r.pause();
        }),
      );
    };
    const subscribe = (participant: ParticipantLike) => {
      if (!isRecordable(participant)) return;
      for (const publication of participant.trackPublications.values()) {
        if (!isMicrophone(publication) || subscribed.has(publication)) continue;
        subscribed.add(publication);
        publication.setSubscribed(true);
      }
    };

    const onParticipant = (participant: ParticipantLike) => subscribe(participant);
    const onPublished = (publication: PublicationLike, participant: ParticipantLike) => {
      if (isRecordable(participant) && isMicrophone(publication)) subscribe(participant);
    };
    const onSubscribed = (
      track: unknown,
      publication: PublicationLike,
      participant: ParticipantLike,
    ) => {
      if (!isRecordable(participant) || !isMicrophone(publication)) return;
      let recorder = recorders.get(participant.identity);
      if (!recorder) {
        recorder = new TrackRecorder(
          {
            db,
            store: this.store,
            tmpDir: this.config.RECORDER_TMP_DIR,
            createEncoder,
            now,
            logger: this.logger,
          },
          { id: meetingId, startedAt },
          participant.identity,
          !enabled(),
        );
        recorders.set(participant.identity, recorder);
      }
      let stream: AsyncIterable<RecordedFrame>;
      try {
        stream = openAudio(track);
      } catch (err) {
        this.logger.error({ err, meetingId }, 'Opening the audio stream failed');
        return;
      }
      const consumer = recorder
        .consume(stream)
        .catch((err) => this.logger.error({ err, meetingId }, 'Audio stream failed'))
        .finally(() => consumers.delete(consumer));
      consumers.add(consumer);
    };
    const onMetadata = (metadata: string) => {
      metaEnabled = decodeRoomMetadata(metadata)?.aiNotesEnabled ?? false;
      if (!metaEnabled) {
        void applyEnabled().catch((err) => this.logger.error({ err, meetingId }, 'Pause failed'));
      }
      requestWake();
    };
    const onDisconnected = () => {
      disconnected = true;
      requestWake();
    };

    room.on(RoomEvent.ParticipantConnected, onParticipant);
    room.on(RoomEvent.TrackPublished, onPublished);
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.RoomMetadataChanged, onMetadata);
    room.on(RoomEvent.Disconnected, onDisconnected);

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        if (wakeRequested || signal.aborted) return resolve();
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          wake = () => undefined;
          resolve();
        };
        const timer = setTimeout(done, ms);
        wake = done;
        signal.addEventListener('abort', done, { once: true });
      });

    const check = async (): Promise<boolean> => {
      const row = await db.meeting.findUnique({
        where: { id: meetingId },
        select: { status: true, aiNotesEnabled: true },
      });
      if (!row || row.status !== 'LIVE') return true;
      if (disconnected) throw new Error('Recorder was disconnected from the room');
      dbEnabled = row.aiNotesEnabled;
      await applyEnabled();
      const present = [...room.remoteParticipants.values()].filter(isRecordable).length;
      if (present > 0) {
        emptySince = null;
        return false;
      }
      emptySince ??= now();
      return now() - emptySince >= this.config.MEETING_EMPTY_GRACE_SEC * 1000;
    };

    let finished = false;
    try {
      for (const participant of room.remoteParticipants.values()) subscribe(participant);
      await applyEnabled();
      while (!signal.aborted) {
        wakeRequested = false;
        if (await check()) {
          finished = true;
          break;
        }
        await sleep(this.hooks.pollMs ?? 10_000);
      }
    } finally {
      room.off(RoomEvent.ParticipantConnected, onParticipant);
      room.off(RoomEvent.TrackPublished, onPublished);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.RoomMetadataChanged, onMetadata);
      room.off(RoomEvent.Disconnected, onDisconnected);
      await Promise.all([...recorders.values()].map((r) => r.stop()));
      await Promise.allSettled(consumers);
      await room.disconnect().catch(() => undefined);
    }
    if (!finished) throw new RecordingAborted('Recording was interrupted');
    await this.complete(meetingId);
    return this.resultOf(meetingId, everEnabled);
  }

  private async complete(meetingId: string): Promise<void> {
    const at = new Date();
    await this.prisma.client.meetingMinutes.update({
      where: { meetingId },
      data: {
        audioCompletedAt: at,
        audioPurgeAfter: new Date(at.getTime() + this.config.MEETING_AUDIO_RETENTION_DAYS * DAY_MS),
      },
    });
    await promoteMinutes(this.minutesQueue as never, meetingId);
  }

  private async resultOf(meetingId: string, wasEnabled: boolean): Promise<RecordingResult> {
    if (!wasEnabled) return 'disabled';
    const chunks = await this.prisma.client.meetingAudioChunk.count({ where: { meetingId } });
    return chunks === 0 ? 'empty' : 'ended';
  }
}
