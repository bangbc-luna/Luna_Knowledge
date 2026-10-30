import { z } from 'zod';
import { baseEnvSchema, databaseEnvSchema, loadEnv, s3EnvSchema } from './env.js';

describe('loadEnv', () => {
  it('áp dụng giá trị mặc định', () => {
    expect(loadEnv(baseEnvSchema, {})).toEqual({ NODE_ENV: 'development', LOG_LEVEL: 'info' });
  });

  it('liệt kê mọi biến sai trong một lỗi', () => {
    const schema = baseEnvSchema.extend({ DATABASE_URL: z.url() });
    expect(() => loadEnv(schema, { NODE_ENV: 'staging' })).toThrow(/NODE_ENV[\s\S]*DATABASE_URL/);
  });

  it('chuyển S3_FORCE_PATH_STYLE từ chuỗi sang boolean', () => {
    const env = loadEnv(s3EnvSchema, {
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'a',
      S3_SECRET_KEY: 'b',
      S3_FORCE_PATH_STYLE: 'false',
      S3_BUCKET_TMP: 'tmp',
      S3_BUCKET_HLS: 'hls',
      S3_BUCKET_PREVIEWS: 'prev',
      S3_BUCKET_THUMBNAILS: 'thumb',
      S3_BUCKET_ASSETS: 'assets',
      S3_BUCKET_ORIGINALS: 'originals',
    });
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });
});

describe('databaseEnvSchema', () => {
  it('đọc DB_STATEMENT_TIMEOUT_MS và để trống thì undefined', () => {
    const url = 'postgresql://a@b/c';
    expect(
      databaseEnvSchema.parse({ DATABASE_URL: url, DB_STATEMENT_TIMEOUT_MS: '1500' })
        .DB_STATEMENT_TIMEOUT_MS,
    ).toBe(1500);
    expect(databaseEnvSchema.parse({ DATABASE_URL: url }).DB_STATEMENT_TIMEOUT_MS).toBeUndefined();
  });
});
