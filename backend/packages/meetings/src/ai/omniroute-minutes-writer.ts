import { z } from 'zod';
import { minutesDraftSchema } from '../minutes/schema.js';
import { omniRouteChat, OmniRouteHttpError } from './omniroute-chat.js';
import {
  MinutesWriterError,
  type MinutesWriteResult,
  type MinutesWriter,
} from './minutes-writer.js';
import { stripJsonFence, type FetchLike } from './speech-to-text.js';

export interface OmniRouteMinutesWriterOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class OmniRouteMinutesWriter implements MinutesWriter {
  readonly provider = 'omniroute';
  readonly model: string;

  constructor(private readonly opts: OmniRouteMinutesWriterOptions) {
    this.model = opts.model;
  }

  async write(input: { system: string; user: string }): Promise<MinutesWriteResult> {
    let out;
    try {
      out = await omniRouteChat(this.opts, {
        model: this.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'minutes_draft',
            strict: true,
            schema: z.toJSONSchema(minutesDraftSchema, { target: 'draft-7' }),
          },
        },
      });
    } catch (err) {
      if (err instanceof OmniRouteHttpError) {
        const code = err.retryable ? 'unavailable' : 'rejected';
        throw new MinutesWriterError(code, err.message, err.retryable);
      }
      throw err;
    }
    if (out.finishReason === 'length') {
      throw new MinutesWriterError('truncated', 'Biên bản bị cắt giữa chừng', false);
    }
    if (out.finishReason === 'content_filter') {
      throw new MinutesWriterError('refused', 'OmniRoute từ chối viết biên bản', false);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(stripJsonFence(out.content));
    } catch {
      throw new MinutesWriterError(
        'invalid_output',
        'Biên bản trả về không phải JSON hợp lệ',
        false,
      );
    }
    const parsed = minutesDraftSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MinutesWriterError('invalid_output', 'Biên bản trả về sai cấu trúc', false);
    }
    return { draft: parsed.data, inputTokens: out.inputTokens, outputTokens: out.outputTokens };
  }
}
