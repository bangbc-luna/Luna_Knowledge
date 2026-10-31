import { describe, expect, it } from 'vitest';
import type { AppConfig } from './app-config.js';
import { loggerParams, stripQuery } from './logger.js';

const cfg = { LOG_LEVEL: 'info', NODE_ENV: 'production' } as AppConfig;

describe('request log', () => {
  it('does not contain the query string (playback session token)', () => {
    expect(stripQuery('/api/v1/videos/x/hls/master.m3u8?s=secret')).toBe(
      '/api/v1/videos/x/hls/master.m3u8',
    );
    expect(stripQuery('/plain')).toBe('/plain');
    expect(stripQuery(undefined)).toBeUndefined();
    const req = (
      loggerParams(cfg).pinoHttp as { serializers: { req: (r: object) => { url: string } } }
    ).serializers.req({ method: 'GET', url: '/a?s=1' });
    expect(req.url).toBe('/a');
  });
});
