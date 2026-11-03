import { z } from 'zod';
import {
  STT_JSON_SCHEMA,
  SttError,
  buildSttPrompt,
  isBodyReadFailure,
  isRetryableStatus,
  normalizeSegments,
  isTimeoutError,
  parseSttSegments,
  readErrorSnippet,
  type FetchLike,
  type SpeechToText,
  type SttAudio,
  type SttSegment,
} from './speech-to-text.js';

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }),
      }),
    )
    .min(1),
});

export interface GeminiSttOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class GeminiSpeechToText implements SpeechToText {
  readonly provider = 'gemini';
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: GeminiSttOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async transcribe(audio: SttAudio, opts: { keyterms: string[] }): Promise<SttSegment[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: buildSttPrompt(opts.keyterms) },
                  { inline_data: { mime_type: audio.mime, data: audio.body.toString('base64') } },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseJsonSchema: STT_JSON_SCHEMA,
            },
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (err) {
      if (isTimeoutError(err)) throw new SttError('Gemini quá thời gian chờ', true);
      throw new SttError('Gemini không kết nối được', true);
    }
    if (!res.ok) {
      const snippet = await readErrorSnippet(res, this.apiKey);
      throw new SttError(`Gemini trả về ${res.status}: ${snippet}`, isRetryableStatus(res.status));
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw new SttError('Phản hồi Gemini không đọc được', isBodyReadFailure(err));
    }
    const parsed = geminiResponseSchema.safeParse(json);
    if (!parsed.success) throw new SttError('Phản hồi Gemini sai cấu trúc', false);
    const text = parsed.data.candidates[0]!.content.parts.map((p) => p.text ?? '').join('');
    return normalizeSegments(parseSttSegments(text), audio.durationMs);
  }
}
