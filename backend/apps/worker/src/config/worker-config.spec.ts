import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './worker-config.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/luna',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  S3_BUCKET_TMP: 'tmp',
  S3_BUCKET_HLS: 'hls',
  S3_BUCKET_PREVIEWS: 'previews',
  S3_BUCKET_THUMBNAILS: 'thumbnails',
  S3_BUCKET_ASSETS: 'assets',
  S3_BUCKET_ORIGINALS: 'originals',
  TIKA_URL: 'http://localhost:9998',
  GOTENBERG_URL: 'http://localhost:3000',
  VIDEO_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
  MEILI_URL: 'http://localhost:7700',
  MEILI_MASTER_KEY: 'meili-master-key-0123456789',
  LIVEKIT_URL: 'wss://livekit.example.test',
  LIVEKIT_API_KEY: 'key',
  LIVEKIT_API_SECRET: 'secret-0123456789-abcdefghijklmnop',
};

describe('loadWorkerConfig', () => {
  it('chạy được ở production khi không đặt biến AI nào, và biên bản AI tắt', () => {
    const config = loadWorkerConfig({ ...baseEnv, NODE_ENV: 'production' });
    expect(config.MEETING_STT_PROVIDER).toBe('none');
    expect(config.MEETING_LLM_PROVIDER).toBe('none');
  });
});
