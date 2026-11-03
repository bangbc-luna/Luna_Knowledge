import { optionalEnv } from '@luna/shared';
import { z } from 'zod';
import { ClaudeMinutesWriter } from './claude-minutes-writer.js';
import { DeepgramSpeechToText } from './deepgram-stt.js';
import { GeminiSpeechToText } from './gemini-stt.js';
import type { MinutesWriter } from './minutes-writer.js';
import { OmniRouteMinutesWriter } from './omniroute-minutes-writer.js';
import { OmniRouteSpeechToText } from './omniroute-stt.js';
import type { SpeechToText } from './speech-to-text.js';
import { FakeMinutesWriter, FakeSpeechToText } from '../testing/fake-ai.js';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

export const minutesAiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    MEETING_STT_PROVIDER: z.enum(['deepgram', 'gemini', 'omniroute', 'fake']).default('fake'),
    DEEPGRAM_API_KEY: optionalEnv(z.string()),
    DEEPGRAM_LANGUAGE: z.enum(['vi', 'multi']).default('vi'),
    GEMINI_API_KEY: optionalEnv(z.string()),
    MEETING_LLM_PROVIDER: z.enum(['anthropic', 'omniroute', 'fake']).default('fake'),
    ANTHROPIC_API_KEY: optionalEnv(z.string()),
    MEETING_LLM_MODEL: z.string().default('claude-opus-5-5'),
    MEETING_LLM_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
    OMNIROUTE_BASE_URL: optionalEnv(z.url()),
    OMNIROUTE_API_KEY: optionalEnv(z.string()),
    MEETING_OMNIROUTE_STT_MODEL: z.string().default('auto/gemini-3.8-flash'),
    MEETING_OMNIROUTE_LLM_MODEL: z.string().default('auto/gemini-3.8-flash'),
    MEETING_STT_USD_PER_MIN: z.coerce.number().min(0).default(0.0043),
    MEETING_LLM_USD_PER_MTOK_IN: z.coerce.number().min(0).default(4),
    MEETING_LLM_USD_PER_MTOK_OUT: z.coerce.number().min(0).default(20),
    MEETING_KEYTERMS: csv,
  })
  .superRefine((env, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (env.MEETING_STT_PROVIDER === 'deepgram') {
      need(
        !!env.DEEPGRAM_API_KEY,
        'DEEPGRAM_API_KEY',
        'DEEPGRAM_API_KEY là bắt buộc khi dùng deepgram',
      );
    }
    if (env.MEETING_STT_PROVIDER === 'gemini') {
      need(!!env.GEMINI_API_KEY, 'GEMINI_API_KEY', 'GEMINI_API_KEY là bắt buộc khi dùng gemini');
    }
    if (env.MEETING_LLM_PROVIDER === 'anthropic') {
      need(
        !!env.ANTHROPIC_API_KEY,
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_API_KEY là bắt buộc khi dùng anthropic',
      );
    }
    if (env.MEETING_STT_PROVIDER === 'omniroute' || env.MEETING_LLM_PROVIDER === 'omniroute') {
      need(
        !!env.OMNIROUTE_API_KEY,
        'OMNIROUTE_API_KEY',
        'OMNIROUTE_API_KEY là bắt buộc khi dùng omniroute',
      );
      need(
        !!env.OMNIROUTE_BASE_URL,
        'OMNIROUTE_BASE_URL',
        'OMNIROUTE_BASE_URL là bắt buộc khi dùng omniroute',
      );
    }
    if (env.NODE_ENV === 'production') {
      need(
        env.MEETING_STT_PROVIDER !== 'fake',
        'MEETING_STT_PROVIDER',
        'Production không được dùng provider fake',
      );
      need(
        env.MEETING_LLM_PROVIDER !== 'fake',
        'MEETING_LLM_PROVIDER',
        'Production không được dùng provider fake',
      );
    }
  });

export type MinutesAiEnv = z.infer<typeof minutesAiEnvSchema>;

export function createSpeechToText(env: MinutesAiEnv): SpeechToText {
  switch (env.MEETING_STT_PROVIDER) {
    case 'deepgram':
      return new DeepgramSpeechToText({
        apiKey: env.DEEPGRAM_API_KEY!,
        model: 'nova-3',
        language: env.DEEPGRAM_LANGUAGE,
      });
    case 'gemini':
      return new GeminiSpeechToText({ apiKey: env.GEMINI_API_KEY!, model: 'gemini-2.5-flash' });
    case 'omniroute':
      return new OmniRouteSpeechToText({
        baseUrl: env.OMNIROUTE_BASE_URL!,
        apiKey: env.OMNIROUTE_API_KEY!,
        model: env.MEETING_OMNIROUTE_STT_MODEL,
      });
    case 'fake':
      return new FakeSpeechToText();
  }
}

export function createMinutesWriter(env: MinutesAiEnv): MinutesWriter {
  switch (env.MEETING_LLM_PROVIDER) {
    case 'anthropic':
      return new ClaudeMinutesWriter({
        apiKey: env.ANTHROPIC_API_KEY!,
        model: env.MEETING_LLM_MODEL,
        effort: env.MEETING_LLM_EFFORT,
      });
    case 'omniroute':
      return new OmniRouteMinutesWriter({
        baseUrl: env.OMNIROUTE_BASE_URL!,
        apiKey: env.OMNIROUTE_API_KEY!,
        model: env.MEETING_OMNIROUTE_LLM_MODEL,
      });
    case 'fake':
      return new FakeMinutesWriter();
  }
}
