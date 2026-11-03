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
import { type Queue, UnrecoverableError } from 'bullmq';
import { RECORDER_CONFIG, type RecorderConfig } from './config.js';
import { PrismaService } from './prisma.provider.js';
import { type AudioEncoder, OpusEncoder } from './opus-encoder.js';
import { type RecordedFrame, TrackRecorder } from './track-recorder.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORDER_IDENTITY = 'luna-recorder';
const RECORDER_NAME = 'Luna AI';
const DAY_MS = 86_400_000;
const MAX_RECONNECT_WINDOW_MS = 6 * 3_600_000;
const STABLE_CONNECTION_MS = 5 * 60_000;

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
  monotonic?: () => number;
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
  private readonly firstDisconnectAt = new Map<string, number>();

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
      if (!minutes) return 'disabled';
      if (!minutes.audioCompletedAt) await this.complete(meetingId);
      return this.resultOf(meetingId);
    }
    if (!meeting.startedAt) {
      throw new UnrecoverableError(`Meeting ${meetingId} is live without a start time`);
    }
    const startedAt = meeting.startedAt;

    const roomName = roomNameFor(meetingId);
    const token = await this.media.joinToken({
      roomName,
      identity: RECORDER_IDENTITY,
      name: RECORDER_NAME,
      role: 'recorder',
    });
    let room: RoomLike;
    try {
      room = await (this.hooks.connectRoom ?? connectRealRoom)(this.media.serverUrl, token);
    } catch {
      throw new Error('Could not connect the recorder to the LiveKit room');
    }
    const openAudio = this.hooks.openAudio ?? openRealAudio;
    const createEncoder =
      this.hooks.createEncoder ??
      (() =>
        new OpusEncoder({
          ffmpegPath: this.config.FFMPEG_PATH,
          nice: this.config.FFMPEG_NICE,
        }));

    const recorders = new Map<string, TrackRecorder>();
    const micPublications = new Map<PublicationLike, { identity: string; on: boolean }>();
    const consumers = new Set<Promise<void>>();
    let dbEnabled = meeting.aiNotesEnabled;
    const initialMeta = decodeRoomMetadata(room.metadata ?? '');
    let metaEnabled = initialMeta?.aiNotesEnabled ?? false;
    let metaVersion = initialMeta?.version ?? -1;
    let recording = false;
    let minutesReady = false;
    let disconnected = false;
    const connectedAt = now();
    let emptySince: number | null = null;
    let wakeRequested = false;
    let wake: () => void = () => undefined;

    const enabled = () => dbEnabled && metaEnabled;
    const requestWake = () => {
      wakeRequested = true;
      wake();
    };
    const syncSubscriptions = () => {
      for (const [publication, entry] of micPublications) {
        if (entry.on === recording) continue;
        try {
          publication.setSubscribed(recording);
          entry.on = recording;
        } catch (err) {
          this.logger.error(
            { err, meetingId, identity: entry.identity },
            'Changing a microphone subscription failed',
          );
        }
      }
    };
    const ensureMinutes = async () => {
      if (minutesReady) return;
      await db.meetingMinutes.upsert({
        where: { meetingId },
        create: {
          meetingId,
          status: 'RECORDING',
          audioPurgeAfter: new Date(now() + this.config.MEETING_AUDIO_RETENTION_DAYS * DAY_MS),
        },
        update: {},
      });
      minutesReady = true;
    };
    const doApply = async () => {
      if (enabled()) {
        await ensureMinutes();
        if (!enabled()) return;
        recording = true;
        syncSubscriptions();
        for (const r of recorders.values()) r.resume();
        return;
      }
      recording = false;
      syncSubscriptions();
      await Promise.all([...recorders.values()].map((r) => r.pause()));
    };
    let applyChain: Promise<void> = Promise.resolve();
    const applyEnabled = () => {
      applyChain = applyChain.then(doApply, doApply);
      return applyChain;
    };
    const subscribe = (participant: ParticipantLike) => {
      if (!isRecordable(participant)) return;
      for (const publication of participant.trackPublications.values()) {
        if (!isMicrophone(publication) || micPublications.has(publication)) continue;
        micPublications.set(publication, { identity: participant.identity, on: false });
      }
      syncSubscriptions();
    };

    const onParticipant = (participant: ParticipantLike) => subscribe(participant);
    const onPublished = (publication: PublicationLike, participant: ParticipantLike) => {
      if (isRecordable(participant) && isMicrophone(publication)) subscribe(participant);
    };
    const onParticipantLeft = (participant: ParticipantLike) => {
      for (const [publication, entry] of micPublications) {
        if (entry.identity === participant.identity) micPublications.delete(publication);
      }
    };
    const onUnpublished = (publication: PublicationLike) => {
      micPublications.delete(publication);
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
            ...(this.hooks.monotonic ? { monotonic: this.hooks.monotonic } : {}),
            logger: this.logger,
          },
          { id: meetingId, startedAt },
          participant.identity,
          !recording,
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
      const decoded = decodeRoomMetadata(metadata);
      if (decoded?.version !== undefined) {
        if (decoded.version < metaVersion) return;
        metaVersion = decoded.version;
      }
      metaEnabled = decoded?.aiNotesEnabled ?? false;
      if (!metaEnabled) {
        recording = false;
        for (const r of recorders.values()) {
          void r.pause().catch((err) => this.logger.error({ err, meetingId }, 'Pause failed'));
        }
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
    room.on(RoomEvent.TrackUnpublished, onUnpublished);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantLeft);
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
      if (disconnected) {
        const first = this.firstDisconnectAt.get(meetingId) ?? now();
        this.firstDisconnectAt.set(meetingId, first);
        if (now() - first > MAX_RECONNECT_WINDOW_MS) {
          this.firstDisconnectAt.delete(meetingId);
          throw new Error('Recorder kept losing the room for too long');
        }
        throw new RecordingAborted('Recorder was disconnected from the room');
      }
      if (now() - connectedAt >= STABLE_CONNECTION_MS) this.firstDisconnectAt.delete(meetingId);
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
      await applyEnabled();
      for (const participant of room.remoteParticipants.values()) subscribe(participant);
      while (!signal.aborted) {
        wakeRequested = false;
        if (await check()) {
          finished = true;
          break;
        }
        await sleep(this.hooks.pollMs ?? 10_000);
      }
    } finally {
      try {
        room.off(RoomEvent.ParticipantConnected, onParticipant);
        room.off(RoomEvent.TrackPublished, onPublished);
        room.off(RoomEvent.TrackUnpublished, onUnpublished);
        room.off(RoomEvent.ParticipantDisconnected, onParticipantLeft);
        room.off(RoomEvent.TrackSubscribed, onSubscribed);
        room.off(RoomEvent.RoomMetadataChanged, onMetadata);
        room.off(RoomEvent.Disconnected, onDisconnected);
        await Promise.allSettled([...recorders.values()].map((r) => r.stop()));
        await Promise.allSettled(consumers);
      } finally {
        await room.disconnect().catch(() => undefined);
      }
    }
    if (!finished) throw new RecordingAborted('Recording was interrupted');
    this.firstDisconnectAt.delete(meetingId);
    const minutes = await db.meetingMinutes.findUnique({
      where: { meetingId },
      select: { meetingId: true },
    });
    if (!minutes) return 'disabled';
    await this.complete(meetingId);
    return this.resultOf(meetingId);
  }

  private async complete(meetingId: string): Promise<void> {
    const meeting = await this.prisma.client.meeting.findUnique({
      where: { id: meetingId },
      select: { status: true },
    });
    if (meeting?.status !== 'ENDED') return;
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

  private async resultOf(meetingId: string): Promise<RecordingResult> {
    const chunks = await this.prisma.client.meetingAudioChunk.count({ where: { meetingId } });
    return chunks === 0 ? 'empty' : 'ended';
  }
}
