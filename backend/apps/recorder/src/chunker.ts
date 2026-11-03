export type ChunkEvent =
  | { type: 'open'; startMs: number }
  | { type: 'data'; samples: Int16Array }
  | { type: 'close'; startMs: number; durationMs: number; voicedMs: number; keep: boolean };

export interface ChunkerOptions {
  sampleRate?: number;
  voiceRms?: number;
  closeAfterSilenceMs?: number;
  maxChunkMs?: number;
  minVoicedMs?: number;
  preRollMs?: number;
}

const GAP_THRESHOLD_MS = 200;

function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

export class SpeechChunker {
  private readonly sampleRate: number;
  private readonly voiceRms: number;
  private readonly closeAfterSilenceMs: number;
  private readonly maxChunkMs: number;
  private readonly minVoicedMs: number;
  private readonly preRollMs: number;
  private preRoll: Int16Array[] = [];
  private preRollSamples = 0;
  private isOpen = false;
  private startMs = 0;
  private endMs = 0;
  private voicedMs = 0;
  private silenceMs = 0;
  private lastEndMs: number | null = null;

  constructor(opts: ChunkerOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 16000;
    this.voiceRms = opts.voiceRms ?? 500;
    this.closeAfterSilenceMs = opts.closeAfterSilenceMs ?? 1500;
    this.maxChunkMs = opts.maxChunkMs ?? 300_000;
    this.minVoicedMs = opts.minVoicedMs ?? 400;
    this.preRollMs = opts.preRollMs ?? 300;
  }

  push(samples: Int16Array, atMs: number): ChunkEvent[] {
    const events: ChunkEvent[] = [];
    const frameMs = (samples.length * 1000) / this.sampleRate;
    this.handleGap(atMs, events);
    const voiced = rms(samples) >= this.voiceRms;
    if (!this.isOpen) {
      if (!voiced) {
        this.remember(samples);
        this.lastEndMs = atMs + frameMs;
        return events;
      }
      this.open(atMs, samples, frameMs, events);
      this.lastEndMs = this.endMs;
      return events;
    }
    this.append(samples, frameMs, voiced, events);
    this.lastEndMs = this.endMs;
    if (this.silenceMs >= this.closeAfterSilenceMs) {
      this.close(events);
    } else if (this.endMs - this.startMs >= this.maxChunkMs) {
      const boundary = this.endMs;
      this.close(events);
      if (voiced) this.reopen(boundary, events);
    }
    return events;
  }

  flush(_atMs: number = this.endMs): ChunkEvent[] {
    const events: ChunkEvent[] = [];
    if (this.isOpen) this.close(events);
    this.preRoll = [];
    this.preRollSamples = 0;
    this.lastEndMs = null;
    return events;
  }

  private handleGap(atMs: number, events: ChunkEvent[]): void {
    if (this.lastEndMs === null) return;
    const gap = atMs - this.lastEndMs;
    if (gap <= GAP_THRESHOLD_MS) return;
    if (!this.isOpen) {
      this.preRoll = [];
      this.preRollSamples = 0;
      return;
    }
    if (this.silenceMs + gap >= this.closeAfterSilenceMs) {
      this.close(events);
      this.preRoll = [];
      this.preRollSamples = 0;
      return;
    }
    const pad = new Int16Array(Math.round((gap * this.sampleRate) / 1000));
    events.push({ type: 'data', samples: pad });
    this.endMs += gap;
    this.silenceMs += gap;
  }

  private remember(samples: Int16Array): void {
    this.preRoll.push(samples);
    this.preRollSamples += samples.length;
    const max = Math.round((this.preRollMs * this.sampleRate) / 1000);
    while (this.preRoll.length > 1 && this.preRollSamples - this.preRoll[0]!.length >= max) {
      this.preRollSamples -= this.preRoll.shift()!.length;
    }
  }

  private open(atMs: number, samples: Int16Array, frameMs: number, events: ChunkEvent[]): void {
    const buffered = this.preRoll;
    const bufferedMs = (this.preRollSamples * 1000) / this.sampleRate;
    this.preRoll = [];
    this.preRollSamples = 0;
    this.isOpen = true;
    this.startMs = Math.round(atMs - Math.min(bufferedMs, this.preRollMs));
    this.endMs = atMs + frameMs;
    this.voicedMs = frameMs;
    this.silenceMs = 0;
    events.push({ type: 'open', startMs: this.startMs });
    const all = new Int16Array(buffered.reduce((n, b) => n + b.length, 0) + samples.length);
    let offset = 0;
    for (const b of buffered) {
      all.set(b, offset);
      offset += b.length;
    }
    all.set(samples, offset);
    events.push({ type: 'data', samples: all });
  }

  private reopen(boundaryMs: number, events: ChunkEvent[]): void {
    this.isOpen = true;
    this.startMs = Math.round(boundaryMs);
    this.endMs = boundaryMs;
    this.voicedMs = 0;
    this.silenceMs = 0;
    events.push({ type: 'open', startMs: this.startMs });
  }

  private append(
    samples: Int16Array,
    frameMs: number,
    voiced: boolean,
    events: ChunkEvent[],
  ): void {
    events.push({ type: 'data', samples });
    this.endMs += frameMs;
    if (voiced) {
      this.voicedMs += frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameMs;
    }
  }

  private close(events: ChunkEvent[]): void {
    const durationMs = Math.round(this.endMs - this.startMs);
    const voicedMs = Math.round(this.voicedMs);
    events.push({
      type: 'close',
      startMs: this.startMs,
      durationMs,
      voicedMs,
      keep: voicedMs >= this.minVoicedMs,
    });
    this.isOpen = false;
    this.voicedMs = 0;
    this.silenceMs = 0;
  }
}
