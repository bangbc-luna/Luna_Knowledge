import { z } from 'zod';

export interface SttSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SttAudio {
  body: Buffer;
  mime: 'audio/ogg';
  durationMs: number;
}

export interface SpeechToText {
  readonly provider: string;
  readonly model: string;
  transcribe(audio: SttAudio, opts: { keyterms: string[] }): Promise<SttSegment[]>;
}

export class SttError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly kind?: 'blocked',
  ) {
    super(message.slice(0, 500));
    this.name = 'SttError';
  }
}

export const sttSegmentsSchema = z.object({
  segments: z.array(
    z.object({
      startSec: z.number().min(0),
      endSec: z.number().min(0),
      text: z.string(),
    }),
  ),
});

export const STT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          text: { type: 'string' },
        },
        required: ['startSec', 'endSec', 'text'],
      },
    },
  },
  required: ['segments'],
} as const;

export const STT_SYSTEM_PROMPT =
  'You are a speech transcription engine. You have no tools. Output only the requested JSON.';

export function buildSttPrompt(keyterms: string[]): string {
  const terms = keyterms.length > 0 ? ` Các thuật ngữ thường gặp: ${keyterms.join(', ')}.` : '';
  return [
    'Chép lại lời nói trong đoạn âm thanh này bằng tiếng Việt, đúng chính tả và có dấu câu.',
    'Giữ nguyên các thuật ngữ tiếng Anh như đã nghe, không dịch.' + terms,
    'Nếu không có lời nói thì trả về mảng segments rỗng, ví dụ {"segments":[]}. Không bịa nội dung, không đoán chữ từ tiếng ồn, nhạc hay tiếng bíp.',
    'Trả về duy nhất một đối tượng JSON dạng {"segments":[{"startSec":number,"endSec":number,"text":string}]}, thời gian tính bằng giây từ đầu đoạn âm thanh, không thêm chữ nào khác.',
  ].join('\n');
}

export function stripJsonFence(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1]! : t;
}

const BLOCKED_TEXT = /blocked|filter|safety|refus/i;

export function sttBlockedError(detail: string): SttError {
  return new SttError(`Nhà cung cấp chặn đoạn âm thanh: ${detail}`, true, undefined, 'blocked');
}

export function parseSttSegments(text: string): SttSegment[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(text));
  } catch {
    if (BLOCKED_TEXT.test(text)) throw sttBlockedError(text.replace(/\s+/g, ' ').slice(0, 200));
    throw new SttError('Phản hồi chép lời không phải JSON hợp lệ', false);
  }
  const parsed = sttSegmentsSchema.safeParse(raw);
  if (!parsed.success) throw new SttError('Phản hồi chép lời sai cấu trúc', false);
  return parsed.data.segments
    .map((s) => {
      const startMs = Math.round(s.startSec * 1000);
      return {
        startMs,
        endMs: Math.max(startMs, Math.round(s.endSec * 1000)),
        text: s.text.trim(),
      };
    })
    .filter((s) => s.text.length > 0);
}

const MAX_CHARS_PER_SECOND = 25;

export function normalizeSegments(segments: SttSegment[], durationMs: number): SttSegment[] {
  const out: SttSegment[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    if (text.length === 0 || s.startMs >= durationMs) continue;
    const endMs = Math.min(Math.max(s.endMs, s.startMs), durationMs);
    const spanMs = endMs - s.startMs;
    if (spanMs <= 0) continue;
    if (text.length / Math.max(1, spanMs / 1000) > MAX_CHARS_PER_SECOND) continue;
    out.push({ startMs: s.startMs, endMs, text });
  }
  return out;
}

export function isBodyReadFailure(err: unknown): boolean {
  return !(err instanceof SyntaxError);
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500 || status === 408;
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function readErrorSnippet(res: Response, secret?: string): Promise<string> {
  try {
    let t = (await res.text()).replace(/\s+/g, ' ');
    if (secret) t = t.split(secret).join('[redacted]');
    return t.slice(0, 300);
  } catch {
    return '';
  }
}
