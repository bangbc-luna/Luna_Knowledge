import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { minutesDraftSchema } from '../minutes/schema.js';
import {
  MinutesWriterError,
  type MinutesWriteResult,
  type MinutesWriter,
} from './minutes-writer.js';

export interface ClaudeMinutesWriterOptions {
  apiKey: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  client?: Anthropic;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FALLBACK_MODELS = new Set(['claude-opus-5-5']);

export class ClaudeMinutesWriter implements MinutesWriter {
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly effort: 'low' | 'medium' | 'high';
  private readonly client: Anthropic;

  constructor(opts: ClaudeMinutesWriterOptions) {
    this.model = opts.model ?? 'claude-opus-5-5';
    this.effort = opts.effort ?? 'medium';
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 });
  }

  async write(input: { system: string; user: string }): Promise<MinutesWriteResult> {
    const base = {
      model: this.model,
      max_tokens: 16000,
      system: input.system,
      messages: [{ role: 'user' as const, content: input.user }],
      output_config: { effort: this.effort, format: zodOutputFormat(minutesDraftSchema) },
    };
    let message;
    try {
      message = FALLBACK_MODELS.has(this.model)
        ? await this.client.beta.messages.parse({
            ...base,
            betas: [FALLBACK_BETA],
            fallbacks: 'default',
          })
        : await this.client.messages.parse(base);
    } catch (err) {
      throw mapAnthropicError(err);
    }
    if (message.stop_reason === 'refusal') {
      throw new MinutesWriterError('refused', 'Claude từ chối viết biên bản', false);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new MinutesWriterError('truncated', 'Biên bản bị cắt giữa chừng', false);
    }
    if (message.parsed_output === null || message.parsed_output === undefined) {
      throw new MinutesWriterError('invalid_output', 'Claude trả về biên bản sai cấu trúc', false);
    }
    return {
      draft: message.parsed_output,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  }
}

function mapAnthropicError(err: unknown): MinutesWriterError {
  if (err instanceof Anthropic.RateLimitError) {
    return new MinutesWriterError('rate_limited', 'Claude giới hạn tốc độ (429)', true);
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new MinutesWriterError('unavailable', `Claude lỗi máy chủ (${err.status})`, true);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new MinutesWriterError(
      'unavailable',
      'Claude không kết nối được hoặc quá thời gian',
      true,
    );
  }
  if (err instanceof Anthropic.APIError) {
    return new MinutesWriterError('rejected', `Claude từ chối yêu cầu (${err.status})`, false);
  }
  return new MinutesWriterError('invalid_output', 'Claude trả về biên bản không đọc được', false);
}
