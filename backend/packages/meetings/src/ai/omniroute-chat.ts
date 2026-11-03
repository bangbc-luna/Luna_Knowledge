import { z } from 'zod';
import {
  isRetryableStatus,
  isTimeoutError,
  readErrorSnippet,
  type FetchLike,
} from './speech-to-text.js';

const chatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

export interface OmniRouteChatResult {
  content: string;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

export class OmniRouteHttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message.slice(0, 500));
    this.name = 'OmniRouteHttpError';
  }
}

export interface OmniRouteClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export async function omniRouteChat(
  opts: OmniRouteClientOptions,
  body: Record<string, unknown>,
): Promise<OmniRouteChatResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    });
  } catch (err) {
    if (isTimeoutError(err)) throw new OmniRouteHttpError('OmniRoute quá thời gian chờ', true);
    throw new OmniRouteHttpError('OmniRoute không kết nối được', true);
  }
  if (!res.ok) {
    const snippet = await readErrorSnippet(res);
    throw new OmniRouteHttpError(
      `OmniRoute trả về ${res.status}: ${snippet}`,
      isRetryableStatus(res.status),
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new OmniRouteHttpError('Phản hồi OmniRoute không phải JSON', false);
  }
  const parsed = chatResponseSchema.safeParse(json);
  if (!parsed.success) throw new OmniRouteHttpError('Phản hồi OmniRoute sai cấu trúc', false);
  const choice = parsed.data.choices[0]!;
  const content = choice.message.content ?? '';
  if (content.trim().length === 0) {
    throw new OmniRouteHttpError(
      `OmniRoute trả về nội dung rỗng (finish_reason ${choice.finish_reason ?? 'null'})`,
      true,
    );
  }
  return {
    content,
    finishReason: choice.finish_reason ?? null,
    inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
    outputTokens: parsed.data.usage?.completion_tokens ?? 0,
  };
}
