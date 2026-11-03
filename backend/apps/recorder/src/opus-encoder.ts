import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

export interface AudioEncoder {
  start(path: string): void;
  write(samples: Int16Array): void;
  finish(): Promise<{ sizeBytes: number }>;
  abort(): void;
}

export interface OpusEncoderOptions {
  ffmpegPath?: string;
  nice?: number;
  finishTimeoutMs?: number;
  maxBacklogBytes?: number;
}

const MAX_STDERR = 2000;
const DEFAULT_FINISH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BACKLOG_BYTES = 2 * 1024 * 1024;

export class OpusEncoder implements AudioEncoder {
  private child?: ChildProcessWithoutNullStreams;
  private path = '';
  private stderr = '';
  private streamError?: Error;
  private exited?: Promise<number | null>;
  private overflowed = false;

  constructor(private readonly opts: OpusEncoderOptions = {}) {}

  start(path: string): void {
    const ffmpeg = this.opts.ffmpegPath ?? 'ffmpeg';
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      's16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-i',
      'pipe:0',
      '-c:a',
      'libopus',
      '-b:a',
      '24k',
      '-application',
      'voip',
      '-f',
      'ogg',
      path,
    ];
    const nice = this.opts.nice ?? 0;
    const child =
      nice > 0 ? spawn('nice', ['-n', String(nice), ffmpeg, ...args]) : spawn(ffmpeg, args);
    this.child = child;
    this.path = path;
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.stderr.length < MAX_STDERR) this.stderr += chunk.toString();
    });
    child.stdin.on('error', (err) => {
      this.streamError = err;
    });
    this.exited = new Promise((resolve) => {
      child.on('error', (err) => {
        this.streamError = err;
        resolve(null);
      });
      child.on('close', (code) => resolve(code));
    });
  }

  write(samples: Int16Array): void {
    if (!this.child || this.streamError || this.overflowed) return;
    this.child.stdin.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    if (
      this.child.stdin.writableLength > (this.opts.maxBacklogBytes ?? DEFAULT_MAX_BACKLOG_BYTES)
    ) {
      this.overflowed = true;
      this.child.kill('SIGKILL');
    }
  }

  async finish(): Promise<{ sizeBytes: number }> {
    const child = this.child;
    if (!child || !this.exited) throw new Error('Encoder was not started');
    if (this.overflowed) {
      await this.exited;
      throw new Error('ffmpeg input backlog exceeded, chunk dropped');
    }
    if (!this.streamError) child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(
        () => resolve('timeout'),
        this.opts.finishTimeoutMs ?? DEFAULT_FINISH_TIMEOUT_MS,
      );
    });
    const code = await Promise.race([this.exited, timeout]).finally(() => clearTimeout(timer));
    if (code === 'timeout') {
      child.kill('SIGKILL');
      throw new Error('ffmpeg did not finish in time');
    }
    if (code !== 0) {
      throw new Error(
        `ffmpeg exited with ${code}: ${(this.streamError?.message ?? this.stderr).slice(0, 500)}`,
      );
    }
    const { size } = await stat(this.path);
    return { sizeBytes: size };
  }

  abort(): void {
    this.child?.kill('SIGKILL');
  }
}
