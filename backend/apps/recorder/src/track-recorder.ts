import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@luna/db';
import type { ObjectStore } from '@luna/shared';
import { type ChunkEvent, SpeechChunker } from './chunker.js';
import type { AudioEncoder } from './opus-encoder.js';

export interface RecorderLogger {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface TrackRecorderDeps {
  db: PrismaClient;
  store: Pick<ObjectStore, 'putFile'>;
  tmpDir: string;
  createEncoder: () => AudioEncoder;
  now?: () => number;
  monotonic?: () => number;
  logger?: RecorderLogger;
  retryDelayMs?: number;
}

export interface RecordedFrame {
  data: Int16Array;
}

interface OpenChunk {
  encoder: AudioEncoder;
  path: string;
}

const SAMPLE_RATE = 16000;
const REAL_GAP_MS = 500;

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

export class TrackRecorder {
  readonly chunker = new SpeechChunker({ sampleRate: SAMPLE_RATE });
  savedChunks = 0;
  private paused = false;
  private stopped = false;
  private current?: OpenChunk;
  private tail: Promise<void> = Promise.resolve();
  private loop: Promise<void> = Promise.resolve();
  private readonly stopSignal: Promise<'stop'>;
  private signalStop!: () => void;
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private wallBaseMs = 0;
  private monoBaseMs = 0;
  private sampleClockMs: number | null = null;
  private pendingSnap: { frame: RecordedFrame; wallMs: number } | null = null;

  constructor(
    private readonly deps: TrackRecorderDeps,
    private readonly meeting: { id: string; startedAt: Date },
    readonly userId: string,
    startPaused = false,
  ) {
    this.paused = startPaused;
    this.now = deps.now ?? Date.now;
    this.monotonic = deps.monotonic ?? (() => performance.now());
    this.stopSignal = new Promise((resolve) => {
      this.signalStop = () => resolve('stop');
    });
  }

  get isPaused(): boolean {
    return this.paused;
  }

  consume(stream: AsyncIterable<RecordedFrame>): Promise<void> {
    const run = this.consumeLoop(stream);
    this.loop = this.loop.then(() => run).catch(() => undefined);
    return run;
  }

  async pause(): Promise<void> {
    if (!this.paused) {
      this.paused = true;
      this.settlePending(false);
      this.handle(this.chunker.flush());
    }
    await this.tail;
  }

  resume(): void {
    this.paused = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.signalStop();
    await this.loop;
    this.handle(this.chunker.flush());
    await this.tail;
  }

  private async consumeLoop(stream: AsyncIterable<RecordedFrame>): Promise<void> {
    const iterator = stream[Symbol.asyncIterator]();
    this.settlePending(false);
    this.wallBaseMs = this.now() - this.meeting.startedAt.getTime();
    this.monoBaseMs = this.monotonic();
    this.sampleClockMs = null;
    try {
      while (!this.stopped) {
        const next = await Promise.race([iterator.next(), this.stopSignal]);
        if (next === 'stop' || next.done) break;
        this.onFrame(next.value);
      }
    } finally {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
      this.settlePending(false);
      if (!this.stopped) this.handle(this.chunker.flush());
    }
  }

  private onFrame(frame: RecordedFrame): void {
    if (this.paused) return;
    const frameMs = (frame.data.length * 1000) / SAMPLE_RATE;
    const wallMs = this.wallBaseMs + (this.monotonic() - this.monoBaseMs);
    if (this.pendingSnap) {
      const pending = this.pendingSnap;
      const realTime = wallMs - pending.wallMs >= frameMs / 2;
      this.settlePending(realTime);
    }
    if (this.sampleClockMs !== null && wallMs - (this.sampleClockMs + frameMs) > REAL_GAP_MS) {
      this.pendingSnap = { frame, wallMs };
      return;
    }
    this.push(frame, wallMs, false);
  }

  private settlePending(snap: boolean): void {
    const pending = this.pendingSnap;
    if (!pending) return;
    this.pendingSnap = null;
    this.push(pending.frame, pending.wallMs, snap);
  }

  private push(frame: RecordedFrame, wallMs: number, snap: boolean): void {
    const frameMs = (frame.data.length * 1000) / SAMPLE_RATE;
    const atMs = snap || this.sampleClockMs === null ? wallMs - frameMs : this.sampleClockMs;
    this.sampleClockMs = Math.min(atMs + frameMs, wallMs + frameMs);
    this.handle(this.chunker.push(frame.data, atMs));
  }

  private handle(events: ChunkEvent[]): void {
    for (const event of events) {
      if (event.type === 'open') {
        const path = join(this.deps.tmpDir, `${randomUUID()}.ogg`);
        const encoder = this.deps.createEncoder();
        encoder.start(path);
        this.current = { encoder, path };
      } else if (event.type === 'data') {
        this.current?.encoder.write(event.samples);
      } else {
        const chunk = this.current;
        this.current = undefined;
        if (chunk) this.enqueue(() => this.finalize(chunk, event));
      }
    }
  }

  private enqueue(job: () => Promise<void>): void {
    this.tail = this.tail
      .then(job)
      .catch((err) =>
        this.deps.logger?.error({ err, meetingId: this.meeting.id }, 'Chunk task failed'),
      );
  }

  private async finalize(
    chunk: OpenChunk,
    close: Extract<ChunkEvent, { type: 'close' }>,
  ): Promise<void> {
    try {
      if (!close.keep) {
        chunk.encoder.abort();
        return;
      }
      const { sizeBytes } = await chunk.encoder.finish();
      const startOffsetMs = Math.max(0, close.startMs);
      const key = `meetings/${this.meeting.id}/${this.userId}/${startOffsetMs}.ogg`;
      const existing = await this.deps.db.meetingAudioChunk.findUnique({
        where: {
          meetingId_userId_startOffsetMs: {
            meetingId: this.meeting.id,
            userId: this.userId,
            startOffsetMs,
          },
        },
        select: { id: true },
      });
      if (existing) return;
      const stored = await this.upload(key, chunk.path);
      try {
        await this.deps.db.meetingAudioChunk.create({
          data: {
            meetingId: this.meeting.id,
            userId: this.userId,
            startOffsetMs,
            durationMs: close.durationMs,
            container: stored.container,
            key: stored.key,
            sizeBytes: BigInt(sizeBytes),
          },
        });
        this.savedChunks++;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    } catch (err) {
      this.deps.logger?.error(
        { err, meetingId: this.meeting.id, userId: this.userId, startMs: close.startMs },
        'Saving an audio chunk failed',
      );
    } finally {
      chunk.encoder.abort();
      await rm(chunk.path, { force: true });
    }
  }

  private async upload(key: string, path: string) {
    const attempts = 3;
    const base = this.deps.retryDelayMs ?? 500;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.deps.store.putFile('meetingAudio', key, path, 'audio/ogg');
      } catch (err) {
        if (attempt >= attempts) throw err;
        this.deps.logger?.warn({ err, key, attempt }, 'Uploading an audio chunk failed, retrying');
        await new Promise((resolve) => setTimeout(resolve, base * attempt * attempt));
      }
    }
  }
}
