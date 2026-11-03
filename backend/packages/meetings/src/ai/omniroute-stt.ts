import { omniRouteChat, OmniRouteHttpError } from './omniroute-chat.js';
import {
  SttError,
  STT_SYSTEM_PROMPT,
  buildSttPrompt,
  parseSttSegments,
  type FetchLike,
  type SpeechToText,
  type SttAudio,
  type SttSegment,
} from './speech-to-text.js';

export interface OmniRouteSttOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class OmniRouteSpeechToText implements SpeechToText {
  readonly provider = 'omniroute';
  readonly model: string;

  constructor(private readonly opts: OmniRouteSttOptions) {
    this.model = opts.model;
  }

  async transcribe(audio: SttAudio, opts: { keyterms: string[] }): Promise<SttSegment[]> {
    let content: string;
    try {
      const out = await omniRouteChat(this.opts, {
        model: this.model,
        temperature: 0,
        messages: [
          { role: 'system', content: STT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: buildSttPrompt(opts.keyterms) },
              {
                type: 'input_audio',
                input_audio: { data: audio.body.toString('base64'), format: 'ogg' },
              },
            ],
          },
        ],
      });
      content = out.content;
    } catch (err) {
      if (err instanceof OmniRouteHttpError) throw new SttError(err.message, err.retryable);
      throw err;
    }
    return parseSttSegments(content);
  }
}
