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
    'Nếu không có lời nói thì trả về mảng segments rỗng. Không bịa nội dung.',
    'Trả về duy nhất một đối tượng JSON dạng {"segments":[{"startSec":number,"endSec":number,"text":string}]}, thời gian tính bằng giây từ đầu đoạn âm thanh, không thêm chữ nào khác.',
  ].join('\n');
}

export function stripJsonFence(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1]! : t;
}

export function parseSttSegments(text: string): SttSegment[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(text));
  } catch {
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

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500 || status === 408;
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function readErrorSnippet(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    return '';
  }
}
