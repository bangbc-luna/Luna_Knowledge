import type { MinutesDraft } from '../minutes/schema.js';
import {
  MinutesWriterError,
  type MinutesWriteResult,
  type MinutesWriter,
} from '../ai/minutes-writer.js';
import {
  SttError,
  type SpeechToText,
  type SttAudio,
  type SttSegment,
} from '../ai/speech-to-text.js';

export class FakeSpeechToText implements SpeechToText {
  readonly provider = 'fake';
  readonly model = 'fake-stt';
  readonly segments = new Map<string, SttSegment[]>();
  readonly calls: Array<{ key: string; durationMs: number; keyterms: string[] }> = [];
  private failures: Array<{ retryable: boolean }> = [];

  setSegments(key: string, segments: SttSegment[]): void {
    this.segments.set(key, segments);
  }

  failTimes(n: number, retryable: boolean): void {
    this.failures = Array.from({ length: n }, () => ({ retryable }));
  }

  async transcribe(audio: SttAudio, opts: { keyterms: string[] }): Promise<SttSegment[]> {
    const key = audio.body.toString('utf8');
    this.calls.push({ key, durationMs: audio.durationMs, keyterms: opts.keyterms });
    const failure = this.failures.shift();
    if (failure) throw new SttError('Lỗi chép lời giả lập', failure.retryable);
    return this.segments.get(key) ?? [{ startMs: 0, endMs: audio.durationMs, text: 'lời nói thử' }];
  }
}

const EMPTY_DRAFT: MinutesDraft = {
  overview: { summary: '', decisions: [], deferred: [], openQuestions: [] },
  actionItems: [],
  topics: [],
  notableChat: [],
};

export class FakeMinutesWriter implements MinutesWriter {
  readonly provider = 'fake';
  readonly model = 'fake-llm';
  readonly calls: Array<{ system: string; user: string }> = [];
  draft: MinutesDraft | null = null;
  private failures: Array<{ retryable: boolean }> = [];

  failTimes(n: number, retryable: boolean): void {
    this.failures = Array.from({ length: n }, () => ({ retryable }));
  }

  async write(input: { system: string; user: string }): Promise<MinutesWriteResult> {
    this.calls.push(input);
    const failure = this.failures.shift();
    if (failure) {
      throw new MinutesWriterError(
        failure.retryable ? 'unavailable' : 'invalid_output',
        'Lỗi viết biên bản giả lập',
        failure.retryable,
      );
    }
    const draft = this.draft ?? this.generate(input.user);
    return { draft, inputTokens: input.user.length, outputTokens: JSON.stringify(draft).length };
  }

  private generate(user: string): MinutesDraft {
    const match = /\[(U[^\s\]]+)/.exec(user);
    if (!match) return EMPTY_DRAFT;
    return {
      overview: { summary: 'Biên bản thử', decisions: [], deferred: [], openQuestions: [] },
      actionItems: [
        {
          task: 'Việc thử',
          ownerSpeakerId: null,
          ownerName: null,
          dueText: null,
          dueDate: null,
          ambiguous: false,
          evidence: [match[1]!],
        },
      ],
      topics: [],
      notableChat: [],
    };
  }
}
