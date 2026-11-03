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
}

const MAX_STDERR = 2000;

export class OpusEncoder implements AudioEncoder {
  private child?: ChildProcessWithoutNullStreams;
  private path = '';
  private stderr = '';
  private streamError?: Error;
  private exited?: Promise<number | null>;

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
    if (!this.child || this.streamError) return;
    this.child.stdin.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  }

  async finish(): Promise<{ sizeBytes: number }> {
    const child = this.child;
    if (!child || !this.exited) throw new Error('Encoder was not started');
    if (!this.streamError) child.stdin.end();
    const code = await this.exited;
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
