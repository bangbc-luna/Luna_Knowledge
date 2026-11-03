import type { MinutesDraft } from '../minutes/schema.js';

export interface MinutesWriteResult {
  draft: MinutesDraft;
  inputTokens: number;
  outputTokens: number;
}

export interface MinutesWriter {
  readonly provider: string;
  readonly model: string;
  write(input: { system: string; user: string }): Promise<MinutesWriteResult>;
}

export type MinutesWriterErrorCode =
  'refused' | 'invalid_output' | 'truncated' | 'rate_limited' | 'unavailable' | 'rejected';

export class MinutesWriterError extends Error {
  constructor(
    readonly code: MinutesWriterErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message.slice(0, 500));
    this.name = 'MinutesWriterError';
  }
}
