import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from './app-config.js';
import { loggerParams, stripQuery } from './logger.js';

const requireFromPlatform = createRequire(
  createRequire(import.meta.url).resolve('@nestjs/platform-express'),
);
const express = requireFromPlatform('express') as () => import('express').Express;

const cfg = { LOG_LEVEL: 'info', NODE_ENV: 'production' } as AppConfig;

describe('request log', () => {
  it('stripQuery removes the query string', () => {
    expect(stripQuery('/api/v1/videos/x/hls/master.m3u8?s=secret')).toBe(
      '/api/v1/videos/x/hls/master.m3u8',
    );
    expect(stripQuery('/plain')).toBe('/plain');
    expect(stripQuery(undefined)).toBeUndefined();
  });

  it('a logged request with a playback token never contains the token', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const { transport: _transport, ...options } = loggerParams(cfg).pinoHttp as Record<
      string,
      unknown
    >;
    const app = express();
    app.use((pinoHttp as unknown as (o: never, s: Writable) => never)(options as never, stream));
    app.get('/a', (_req, res) => res.send('ok'));
    await request(app).get('/a?s=secret&token=secret2').expect(200);
    await new Promise((r) => setTimeout(r, 20));
    const out = lines.join('');
    expect(out).toContain('/a');
    expect(out).not.toContain('secret');
  });
});
