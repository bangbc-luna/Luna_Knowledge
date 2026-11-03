import { randomUUID } from 'node:crypto';
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
  logger?: RecorderLogger;
}

export interface RecordedFrame {
  data: Int16Array;
}

interface OpenChunk {
  encoder: AudioEncoder;
  path: string;
}

const SAMPLE_RATE = 16000;

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

  constructor(
    private readonly deps: TrackRecorderDeps,
    private readonly meeting: { id: string; startedAt: Date },
    readonly userId: string,
    startPaused = false,
  ) {
    this.paused = startPaused;
    this.now = deps.now ?? Date.now;
    this.stopSignal = new Promise((resolve) => {
      this.signalStop = () => resolve('stop');
    });
  }

  get isPaused(): boolean {
    return this.paused;
  }

  consume(stream: AsyncIterable<RecordedFrame>): Promise<void> {
    const run = this.consumeLoop(stream);
    this.loop = this.loop.then(() => run);
    return run;
  }

  async pause(): Promise<void> {
    if (!this.paused) {
      this.paused = true;
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
    try {
      while (!this.stopped) {
        const next = await Promise.race([iterator.next(), this.stopSignal]);
        if (next === 'stop' || next.done) break;
        this.onFrame(next.value);
      }
    } finally {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
      if (!this.stopped) this.handle(this.chunker.flush());
    }
  }

  private onFrame(frame: RecordedFrame): void {
    if (this.paused) return;
    const frameMs = (frame.data.length * 1000) / SAMPLE_RATE;
    const atMs = this.now() - this.meeting.startedAt.getTime() - frameMs;
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
    this.tail = this.tail.then(job);
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
      const key = `meetings/${this.meeting.id}/${this.userId}/${Math.max(0, close.startMs)}.ogg`;
      const stored = await this.deps.store.putFile('meetingAudio', key, chunk.path, 'audio/ogg');
      try {
        await this.deps.db.meetingAudioChunk.create({
          data: {
            meetingId: this.meeting.id,
            userId: this.userId,
            startOffsetMs: Math.max(0, close.startMs),
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
}
