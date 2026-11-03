import { z } from 'zod';
import {
  SttError,
  isBodyReadFailure,
  isRetryableStatus,
  normalizeSegments,
  isTimeoutError,
  readErrorSnippet,
  type FetchLike,
  type SpeechToText,
  type SttAudio,
  type SttSegment,
} from './speech-to-text.js';

const deepgramResponseSchema = z.object({
  results: z.object({
    utterances: z
      .array(z.object({ start: z.number(), end: z.number(), transcript: z.string() }))
      .optional(),
  }),
});

export interface DeepgramSttOptions {
  apiKey: string;
  model: 'nova-3';
  language: 'vi' | 'multi';
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class DeepgramSpeechToText implements SpeechToText {
  readonly provider = 'deepgram';
  readonly model: string;
  private readonly apiKey: string;
  private readonly language: 'vi' | 'multi';
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: DeepgramSttOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.language = opts.language;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async transcribe(audio: SttAudio, opts: { keyterms: string[] }): Promise<SttSegment[]> {
    const params = new URLSearchParams({
      model: this.model,
      language: this.language,
      smart_format: 'true',
      punctuate: 'true',
      utterances: 'true',
    });
    if (this.language === 'multi') {
      for (const k of opts.keyterms) params.append('keyterm', k);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'audio/ogg' },
        body: new Uint8Array(audio.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (isTimeoutError(err)) throw new SttError('Deepgram quá thời gian chờ', true);
      throw new SttError('Deepgram không kết nối được', true);
    }
    if (!res.ok) {
      const snippet = await readErrorSnippet(res, this.apiKey);
      throw new SttError(
        `Deepgram trả về ${res.status}: ${snippet}`,
        isRetryableStatus(res.status),
        res.status,
      );
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw new SttError('Phản hồi Deepgram không đọc được', isBodyReadFailure(err));
    }
    const parsed = deepgramResponseSchema.safeParse(json);
    if (!parsed.success) throw new SttError('Phản hồi Deepgram sai cấu trúc', false);
    const segments = (parsed.data.results.utterances ?? []).map((u) => ({
      startMs: Math.round(u.start * 1000),
      endMs: Math.round(u.end * 1000),
      text: u.transcript,
    }));
    return normalizeSegments(segments, audio.durationMs);
  }
}
