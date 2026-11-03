import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { FakeMinutesWriter, FakeSpeechToText } from '../testing/fake-ai.js';
import {
  createMinutesWriter,
  createSpeechToText,
  minutesAiAvailable,
  minutesAiEnvSchema,
  minutesProviderEnvSchema,
} from './ai-env.js';
import { ClaudeMinutesWriter } from './claude-minutes-writer.js';
import { llmCostMicroUsd, sttCostMicroUsd } from './cost.js';
import { DeepgramSpeechToText } from './deepgram-stt.js';
import { GeminiSpeechToText } from './gemini-stt.js';
import { MinutesWriterError } from './minutes-writer.js';
import { OmniRouteMinutesWriter } from './omniroute-minutes-writer.js';
import { OmniRouteSpeechToText } from './omniroute-stt.js';
import { SttError, normalizeSegments, buildSttPrompt, type FetchLike } from './speech-to-text.js';

const audio = { body: Buffer.from('ogg-bytes'), mime: 'audio/ogg' as const, durationMs: 5000 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const chat = (content: string | null, usage = { prompt_tokens: 11, completion_tokens: 7 }) =>
  json({ choices: [{ finish_reason: 'stop', message: { content } }], usage });

const draft = {
  overview: { summary: 's', decisions: [], deferred: [], openQuestions: [] },
  actionItems: [],
  topics: [],
  notableChat: [],
};

describe('Deepgram', () => {
  it('gửi ogg với model nova-3 language vi, đổi giây thành ms, 429 là lỗi thử lại được, 400 thì không', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({ results: { utterances: [{ start: 1.5, end: 2.25, transcript: ' xin chào ' }] } }),
      );
    const stt = new DeepgramSpeechToText({
      apiKey: 'k',
      model: 'nova-3',
      language: 'vi',
      fetchImpl,
    });
    const out = await stt.transcribe(audio, { keyterms: ['sprint'] });
    expect(out).toEqual([{ startMs: 1500, endMs: 2250, text: 'xin chào' }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('model=nova-3');
    expect(url).toContain('language=vi');
    expect(url).toContain('utterances=true');
    expect(init.headers).toMatchObject({ Authorization: 'Token k', 'Content-Type': 'audio/ogg' });

    const f429 = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
    await expect(
      new DeepgramSpeechToText({
        apiKey: 'k',
        model: 'nova-3',
        language: 'vi',
        fetchImpl: f429,
      }).transcribe(audio, { keyterms: [] }),
    ).rejects.toMatchObject({ retryable: true });
    const f400 = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    await expect(
      new DeepgramSpeechToText({
        apiKey: 'k',
        model: 'nova-3',
        language: 'vi',
        fetchImpl: f400,
      }).transcribe(audio, { keyterms: [] }),
    ).rejects.toMatchObject({ retryable: false });
  });
});

describe('Gemini', () => {
  it('phản hồi sai schema → lỗi không thử lại', async () => {
    const wrong = vi
      .fn()
      .mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: '{"x":1}' }] } }] }));
    const stt = new GeminiSpeechToText({
      apiKey: 'k',
      model: 'gemini-2.5-flash',
      fetchImpl: wrong,
    });
    await expect(stt.transcribe(audio, { keyterms: [] })).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('đọc segments hợp lệ và đổi giây thành ms', async () => {
    const ok = vi.fn().mockResolvedValue(
      json({
        candidates: [
          {
            content: {
              parts: [{ text: '{"segments":[{"startSec":0,"endSec":1.2,"text":"alo"}]}' }],
            },
          },
        ],
      }),
    );
    const stt = new GeminiSpeechToText({ apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl: ok });
    expect(await stt.transcribe(audio, { keyterms: [] })).toEqual([
      { startMs: 0, endMs: 1200, text: 'alo' },
    ]);
  });
});

describe('OmniRoute chép lời', () => {
  const make = (fetchImpl: FetchLike) =>
    new OmniRouteSpeechToText({
      baseUrl: 'https://or.test/v1',
      apiKey: 'secret-key',
      model: 'auto/gemini-3.8-flash',
      fetchImpl,
    });

  it('gửi input_audio ogg qua chat/completions và đọc segments, chịu được khối code', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        chat('```json\n{"segments":[{"startSec":0.5,"endSec":2,"text":"họp sprint"}]}\n```'),
      );
    const out = await make(fetchImpl).transcribe(audio, { keyterms: ['sprint'] });
    expect(out).toEqual([{ startMs: 500, endMs: 2000, text: 'họp sprint' }]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://or.test/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer secret-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('auto/gemini-3.8-flash');
    expect(body.messages[0].role).toBe('system');
    const parts = body.messages[1].content;
    expect(parts[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: audio.body.toString('base64'), format: 'ogg' },
    });
    expect(parts[0].text).toContain('sprint');
  });

  it('JSON sai cấu trúc → không thử lại; 429, 503 → thử lại; 401 → không; lỗi không lộ khoá', async () => {
    await expect(
      make(vi.fn().mockResolvedValue(chat('{"segments":[{"text":1}]}'))).transcribe(audio, {
        keyterms: [],
      }),
    ).rejects.toMatchObject({ retryable: false });
    await expect(
      make(vi.fn().mockResolvedValue(chat('không phải json'))).transcribe(audio, { keyterms: [] }),
    ).rejects.toMatchObject({ retryable: false });
    for (const [status, retryable] of [
      [429, true],
      [503, true],
      [401, false],
      [400, false],
    ] as const) {
      const err = await make(vi.fn().mockResolvedValue(new Response('x'.repeat(2000), { status })))
        .transcribe(audio, { keyterms: [] })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SttError);
      expect((err as SttError).retryable).toBe(retryable);
      expect((err as SttError).message.length).toBeLessThanOrEqual(500);
      expect((err as SttError).message).not.toContain('secret-key');
    }
  });

  it('nội dung rỗng và lỗi mạng đều thử lại được', async () => {
    await expect(
      make(vi.fn().mockResolvedValue(chat(null))).transcribe(audio, { keyterms: [] }),
    ).rejects.toMatchObject({ retryable: true });
    await expect(
      make(vi.fn().mockRejectedValue(new TypeError('fetch failed'))).transcribe(audio, {
        keyterms: [],
      }),
    ).rejects.toMatchObject({ retryable: true });
  });
});

describe('OmniRoute viết biên bản', () => {
  const make = (fetchImpl: FetchLike) =>
    new OmniRouteMinutesWriter({
      baseUrl: 'https://or.test/v1',
      apiKey: 'secret-key',
      model: 'auto/gemini-3.8-flash',
      fetchImpl,
    });

  it('gửi system + user, json_schema, đọc draft và đếm token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(chat(JSON.stringify(draft)));
    const out = await make(fetchImpl).write({ system: 'SYS', user: 'USR' });
    expect(out).toEqual({ draft, inputTokens: 11, outputTokens: 7 });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.schema.properties.overview).toBeDefined();
    expect(body.temperature).toBeLessThanOrEqual(0.3);
  });

  it('JSON sai schema → invalid_output không thử lại; 429 và 5xx thử lại; 4xx khác không', async () => {
    const bad = await make(vi.fn().mockResolvedValue(chat('{"overview":1}')))
      .write({ system: 's', user: 'u' })
      .catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(MinutesWriterError);
    expect(bad).toMatchObject({ code: 'invalid_output', retryable: false });
    for (const [status, retryable] of [
      [429, true],
      [502, true],
      [403, false],
    ] as const) {
      const err = await make(vi.fn().mockResolvedValue(new Response('boom', { status })))
        .write({ system: 's', user: 'u' })
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ retryable });
      expect((err as Error).message).not.toContain('secret-key');
    }
  });
});

describe('Claude', () => {
  const fakeClient = (message: Record<string, unknown>) => {
    const parse = vi.fn().mockResolvedValue(message);
    const betaParse = vi.fn().mockResolvedValue(message);
    return {
      client: {
        messages: { parse },
        beta: { messages: { parse: betaParse } },
      } as unknown as Anthropic,
      parse,
      betaParse,
    };
  };
  const ok = {
    stop_reason: 'end_turn',
    parsed_output: draft,
    usage: { input_tokens: 30000, output_tokens: 6000 },
  };

  it('gửi đúng model, effort, structured output; ghi đủ token', async () => {
    const { client, betaParse } = fakeClient(ok);
    const out = await new ClaudeMinutesWriter({ apiKey: 'k', effort: 'high', client }).write({
      system: 'SYS',
      user: 'USR',
    });
    expect(out).toEqual({ draft, inputTokens: 30000, outputTokens: 6000 });
    const params = betaParse.mock.calls[0]![0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBe(16000);
    expect(params.system).toBe('SYS');
    expect(params.messages).toEqual([{ role: 'user', content: 'USR' }]);
    expect(params.output_config.effort).toBe('high');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.fallbacks).toBe('default');
    expect(params.temperature).toBeUndefined();
    expect(params.thinking).toBeUndefined();
  });

  it('model khác Opus 5.5 dùng messages.parse thường, không fallback', async () => {
    const { client, parse, betaParse } = fakeClient(ok);
    await new ClaudeMinutesWriter({ apiKey: 'k', model: 'claude-sonnet-5-5', client }).write({
      system: 's',
      user: 'u',
    });
    expect(betaParse).not.toHaveBeenCalled();
    expect(parse.mock.calls[0]![0].fallbacks).toBeUndefined();
  });

  it('refusal, parsed_output null, max_tokens thành lỗi không thử lại', async () => {
    for (const [msg, code] of [
      [{ ...ok, stop_reason: 'refusal', parsed_output: null }, 'refused'],
      [{ ...ok, parsed_output: null }, 'invalid_output'],
      [{ ...ok, stop_reason: 'max_tokens' }, 'truncated'],
    ] as const) {
      const { client } = fakeClient(msg);
      await expect(
        new ClaudeMinutesWriter({ apiKey: 'k', client }).write({ system: 's', user: 'u' }),
      ).rejects.toMatchObject({ code, retryable: false });
    }
  });

  it('RateLimitError, InternalServerError, lỗi kết nối thử lại được; 400 thì không', async () => {
    const h = new Headers();
    const cases: Array<[Error, boolean]> = [
      [new Anthropic.RateLimitError(429, {}, 'rl', h), true],
      [new Anthropic.InternalServerError(500, {}, 'ise', h), true],
      [new Anthropic.APIConnectionError({ message: 'net' }), true],
      [new Anthropic.BadRequestError(400, {}, 'bad', h), false],
    ];
    for (const [error, retryable] of cases) {
      const client = {
        beta: { messages: { parse: vi.fn().mockRejectedValue(error) } },
      } as unknown as Anthropic;
      const err = await new ClaudeMinutesWriter({ apiKey: 'k', client })
        .write({ system: 's', user: 'u' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MinutesWriterError);
      expect((err as MinutesWriterError).retryable).toBe(retryable);
    }
  });
});

describe('env', () => {
  it('provider deepgram thiếu DEEPGRAM_API_KEY → lỗi cấu hình; production không cho fake', () => {
    expect(minutesAiEnvSchema.safeParse({ MEETING_STT_PROVIDER: 'deepgram' }).success).toBe(false);
    expect(
      minutesAiEnvSchema.safeParse({ MEETING_STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'k' })
        .success,
    ).toBe(true);
    expect(
      minutesAiEnvSchema.safeParse({ NODE_ENV: 'production', MEETING_STT_PROVIDER: 'fake' })
        .success,
    ).toBe(false);
    expect(
      minutesAiEnvSchema.safeParse({ NODE_ENV: 'production', MEETING_LLM_PROVIDER: 'fake' })
        .success,
    ).toBe(false);
    expect(minutesAiEnvSchema.safeParse({ MEETING_LLM_PROVIDER: 'anthropic' }).success).toBe(false);
  });

  it('provider omniroute cần khoá và địa chỉ; mặc định model auto/gemini-3.8-flash', () => {
    expect(minutesAiEnvSchema.safeParse({ MEETING_STT_PROVIDER: 'omniroute' }).success).toBe(false);
    expect(
      minutesAiEnvSchema.safeParse({ MEETING_LLM_PROVIDER: 'omniroute', OMNIROUTE_API_KEY: 'k' })
        .success,
    ).toBe(false);
    const parsed = minutesAiEnvSchema.parse({
      MEETING_STT_PROVIDER: 'omniroute',
      MEETING_LLM_PROVIDER: 'omniroute',
      OMNIROUTE_API_KEY: 'k',
      OMNIROUTE_BASE_URL: 'https://or.test/v1',
      MEETING_KEYTERMS: 'sprint, release ,',
    });
    expect(parsed.MEETING_OMNIROUTE_STT_MODEL).toBe('auto/gemini-3.8-flash');
    expect(parsed.MEETING_OMNIROUTE_LLM_MODEL).toBe('auto/gemini-3.8-flash');
    expect(parsed.MEETING_KEYTERMS).toEqual(['sprint', 'release']);
    expect(createSpeechToText(parsed).provider).toBe('omniroute');
    expect(createMinutesWriter(parsed).provider).toBe('omniroute');
  });

  it('chuỗi rỗng coi như chưa đặt khoá; mặc định là none và biên bản AI không khả dụng', () => {
    const parsed = minutesAiEnvSchema.parse({ OMNIROUTE_API_KEY: '' });
    expect(parsed.OMNIROUTE_API_KEY).toBeUndefined();
    expect(parsed.MEETING_STT_PROVIDER).toBe('none');
    expect(parsed.MEETING_LLM_PROVIDER).toBe('none');
    expect(minutesAiAvailable(parsed)).toBe(false);
    expect(() => createSpeechToText(parsed)).toThrow('AI minutes are not configured');
    expect(() => createMinutesWriter(parsed)).toThrow('AI minutes are not configured');
  });

  it('none được phép ở production; chỉ khả dụng khi cả hai provider đều được đặt', () => {
    const prod = minutesAiEnvSchema.parse({ NODE_ENV: 'production' });
    expect(minutesAiAvailable(prod)).toBe(false);
    const sttOnly = minutesAiEnvSchema.parse({ MEETING_STT_PROVIDER: 'fake' });
    expect(minutesAiAvailable(sttOnly)).toBe(false);
    const both = minutesAiEnvSchema.parse({
      MEETING_STT_PROVIDER: 'fake',
      MEETING_LLM_PROVIDER: 'fake',
    });
    expect(minutesAiAvailable(both)).toBe(true);
  });

  it('nhóm provider tách riêng không cần khoá nhà cung cấp', () => {
    const parsed = minutesProviderEnvSchema.parse({});
    expect(parsed).toEqual({ MEETING_STT_PROVIDER: 'none', MEETING_LLM_PROVIDER: 'none' });
  });
});

describe('chi phí', () => {
  it('90 giây Deepgram 0,0043 USD/phút = 6450 micro USD; 30k vào 6k ra Opus = 240000 micro USD', () => {
    expect(sttCostMicroUsd(90_000, 0.0043)).toBe(6450n);
    expect(llmCostMicroUsd(30_000, 6_000, 4, 20)).toBe(240000n);
    expect(llmCostMicroUsd(1, 0, 0.5, 0)).toBe(1n);
  });
});

describe('fake', () => {
  it('FakeSpeechToText trả câu mặc định dài bằng durationMs và failTimes', async () => {
    const f = new FakeSpeechToText();
    expect(await f.transcribe(audio, { keyterms: [] })).toEqual([
      { startMs: 0, endMs: 5000, text: 'lời nói thử' },
    ]);
    f.failTimes(1, true);
    await expect(f.transcribe(audio, { keyterms: [] })).rejects.toMatchObject({ retryable: true });
    expect(f.calls).toHaveLength(2);
  });

  it('FakeMinutesWriter sinh việc từ dòng U đầu tiên và ghi calls', async () => {
    const w = new FakeMinutesWriter();
    const out = await w.write({ system: 's', user: '[U3 00:01] S1 An: làm đi' });
    expect(out.draft.actionItems[0]!.evidence).toEqual(['U3']);
    expect(w.calls).toHaveLength(1);
  });
});

describe('chuẩn hoá đoạn chép lời', () => {
  const seg = (startMs: number, endMs: number, text: string) => ({ startMs, endMs, text });

  it('bỏ đoạn bắt đầu sau độ dài âm thanh, kẹp endMs vào [startMs, durationMs]', () => {
    expect(normalizeSegments([seg(6000, 7000, 'ngoài'), seg(5000, 6000, 'sát mép')], 5000)).toEqual(
      [],
    );
    expect(normalizeSegments([seg(1000, 9000, 'dài quá')], 5000)).toEqual([
      seg(1000, 5000, 'dài quá'),
    ]);
  });

  it('đoạn đảo ngược hoặc dài bằng 0 hoặc chỉ có khoảng trắng bị bỏ', () => {
    expect(normalizeSegments([seg(3000, 2000, 'đảo')], 5000)).toEqual([]);
    expect(normalizeSegments([seg(1000, 1000, 'không dài')], 5000)).toEqual([]);
    expect(normalizeSegments([seg(1000, 2000, '   \n ')], 5000)).toEqual([]);
  });

  it('câu bịa quá dày ký tự trên một giây bị bỏ, câu bình thường giữ lại', () => {
    const invented =
      'Chậm trễ này kia là bắt đầu chuyển sang sprint sau và cũng là hết hạn vào ngày mai';
    expect(normalizeSegments([seg(0, 1000, invented)], 5000)).toEqual([]);
    expect(normalizeSegments([seg(0, 4000, invented)], 5000)).toHaveLength(1);
    expect(normalizeSegments([seg(0, 200, invented)], 5000)).toEqual([]);
  });

  it('mọi adapter dùng chuẩn hoá: Deepgram và OmniRoute bỏ đoạn ngoài thời lượng', async () => {
    const dg = vi.fn().mockResolvedValue(
      json({
        results: {
          utterances: [
            { start: 9, end: 10, transcript: 'ngoài' },
            { start: 0, end: 1, transcript: 'ok' },
          ],
        },
      }),
    );
    const out = await new DeepgramSpeechToText({
      apiKey: 'k',
      model: 'nova-3',
      language: 'vi',
      fetchImpl: dg,
    }).transcribe(audio, { keyterms: [] });
    expect(out).toEqual([{ startMs: 0, endMs: 1000, text: 'ok' }]);
    const or = vi
      .fn()
      .mockResolvedValue(chat('{"segments":[{"startSec":8,"endSec":9,"text":"ngoài"}]}'));
    const stt = new OmniRouteSpeechToText({
      baseUrl: 'https://or.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: or,
    });
    expect(await stt.transcribe(audio, { keyterms: [] })).toEqual([]);
  });

  it('prompt có ví dụ rỗng và dặn không đoán chữ từ tiếng ồn', () => {
    const p = buildSttPrompt([]);
    expect(p).toContain('{"segments":[]}');
    expect(p).toContain('không đoán chữ từ tiếng ồn, nhạc hay tiếng bíp');
  });
});

describe('lỗi khi đọc thân phản hồi và rò khoá', () => {
  const bodyFail = (err: Error) => {
    const res = new Response('{}', { status: 200 });
    vi.spyOn(res, 'json').mockRejectedValue(err);
    return vi.fn().mockResolvedValue(res);
  };
  const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });

  it('mất kết nối hoặc quá hạn khi đọc thân là lỗi thử lại được; SyntaxError thì không', async () => {
    const mk = {
      deepgram: (f: FetchLike) =>
        new DeepgramSpeechToText({ apiKey: 'k', model: 'nova-3', language: 'vi', fetchImpl: f }),
      gemini: (f: FetchLike) => new GeminiSpeechToText({ apiKey: 'k', model: 'g', fetchImpl: f }),
      omniroute: (f: FetchLike) =>
        new OmniRouteSpeechToText({
          baseUrl: 'https://or.test/v1',
          apiKey: 'k',
          model: 'm',
          fetchImpl: f,
        }),
    };
    for (const make of Object.values(mk)) {
      await expect(
        make(bodyFail(timeout)).transcribe(audio, { keyterms: [] }),
      ).rejects.toMatchObject({ retryable: true });
      await expect(
        make(bodyFail(new TypeError('terminated'))).transcribe(audio, { keyterms: [] }),
      ).rejects.toMatchObject({ retryable: true });
      await expect(
        make(bodyFail(new SyntaxError('bad json'))).transcribe(audio, { keyterms: [] }),
      ).rejects.toMatchObject({ retryable: false });
    }
    const w = new OmniRouteMinutesWriter({
      baseUrl: 'https://or.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: bodyFail(timeout),
    });
    await expect(w.write({ system: 's', user: 'u' })).rejects.toMatchObject({ retryable: true });
  });

  it('thân lỗi lặp lại khoá thì khoá bị che và độ dài vẫn bị cắt', async () => {
    const key = 'sk-very-secret-key-123';
    const body = `Authorization: Bearer ${key} ${'y'.repeat(2000)}`;
    const stt = new OmniRouteSpeechToText({
      baseUrl: 'https://or.test/v1',
      apiKey: key,
      model: 'm',
      fetchImpl: vi.fn().mockResolvedValue(new Response(body, { status: 401 })),
    });
    const e1 = (await stt.transcribe(audio, { keyterms: [] }).catch((e: unknown) => e)) as Error;
    expect(e1.message).not.toContain(key);
    expect(e1.message.length).toBeLessThanOrEqual(500);
    const dg = new DeepgramSpeechToText({
      apiKey: key,
      model: 'nova-3',
      language: 'vi',
      fetchImpl: vi.fn().mockResolvedValue(new Response(`Token ${key}`, { status: 401 })),
    });
    expect(
      ((await dg.transcribe(audio, { keyterms: [] }).catch((e: unknown) => e)) as Error).message,
    ).not.toContain(key);
    const w = new OmniRouteMinutesWriter({
      baseUrl: 'https://or.test/v1',
      apiKey: key,
      model: 'm',
      fetchImpl: vi.fn().mockResolvedValue(new Response(`Bearer ${key}`, { status: 400 })),
    });
    expect(
      ((await w.write({ system: 's', user: 'u' }).catch((e: unknown) => e)) as Error).message,
    ).not.toContain(key);
  });
});

describe('OmniRoute viết biên bản: finish_reason', () => {
  const withReason = (reason: string) =>
    new OmniRouteMinutesWriter({
      baseUrl: 'https://or.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: vi.fn().mockResolvedValue(
        json({
          choices: [{ finish_reason: reason, message: { content: JSON.stringify(draft) } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      ),
    });

  it('length thành truncated, content_filter thành refused, đều không thử lại', async () => {
    await expect(withReason('length').write({ system: 's', user: 'u' })).rejects.toMatchObject({
      code: 'truncated',
      retryable: false,
    });
    await expect(
      withReason('content_filter').write({ system: 's', user: 'u' }),
    ).rejects.toMatchObject({ code: 'refused', retryable: false });
    expect((await withReason('stop').write({ system: 's', user: 'u' })).draft).toEqual(draft);
  });
});

describe('Claude: lỗi parse và nhánh messages.parse', () => {
  const run = async (error: Error, model?: string) => {
    const rejecting = vi.fn().mockRejectedValue(error);
    const client = {
      messages: { parse: rejecting },
      beta: { messages: { parse: rejecting } },
    } as unknown as Anthropic;
    return (await new ClaudeMinutesWriter({ apiKey: 'k', model, client })
      .write({ system: 's', user: 'u' })
      .catch((e: unknown) => e)) as MinutesWriterError;
  };

  it('AnthropicError "Failed to parse structured output" thành truncated; AnthropicError khác thành invalid_output', async () => {
    const cut = await run(
      new Anthropic.AnthropicError(
        'Failed to parse structured output: Unexpected end of JSON input',
      ),
    );
    expect(cut).toMatchObject({ code: 'truncated', retryable: false });
    const other = await run(new Anthropic.AnthropicError('something else'));
    expect(other).toMatchObject({ code: 'invalid_output', retryable: false });
    const apiErr = await run(
      new Anthropic.BadRequestError(400, {}, 'Failed to parse structured output', new Headers()),
    );
    expect(apiErr).toMatchObject({ code: 'rejected', retryable: false });
  });

  it('nhánh messages.parse (không phải Opus 5.5) cũng ánh xạ lỗi, 408 thử lại được', async () => {
    const h = new Headers();
    expect(
      await run(new Anthropic.RateLimitError(429, {}, 'rl', h), 'claude-sonnet-5-5'),
    ).toMatchObject({ retryable: true });
    expect(
      await run(new Anthropic.InternalServerError(503, {}, 'x', h), 'claude-sonnet-5-5'),
    ).toMatchObject({ retryable: true });
    expect(
      await run(new Anthropic.APIError(408, {}, 'timeout', h), 'claude-sonnet-5-5'),
    ).toMatchObject({ retryable: true });
    expect(
      await run(new Anthropic.BadRequestError(400, {}, 'bad', h), 'claude-sonnet-5-5'),
    ).toMatchObject({ retryable: false });
    expect(
      await run(
        new Anthropic.AnthropicError('Failed to parse structured output'),
        'claude-sonnet-5-5',
      ),
    ).toMatchObject({ code: 'truncated' });
  });
});

describe('env: giá không âm', () => {
  it('giá âm bị từ chối', () => {
    for (const k of [
      'MEETING_STT_USD_PER_MIN',
      'MEETING_LLM_USD_PER_MTOK_IN',
      'MEETING_LLM_USD_PER_MTOK_OUT',
    ]) {
      expect(minutesAiEnvSchema.safeParse({ [k]: '-1' }).success).toBe(false);
      expect(minutesAiEnvSchema.safeParse({ [k]: '0' }).success).toBe(true);
    }
  });
});
