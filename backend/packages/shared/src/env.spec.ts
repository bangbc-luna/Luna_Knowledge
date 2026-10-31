import { z } from 'zod';
import { baseEnvSchema, databaseEnvSchema, loadEnv, s3EnvSchema } from './env.js';
import { observabilityEnvSchema } from './observability.js';

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

describe('optionalEnv', () => {
  const url = 'postgresql://a@b/c';

  it('để trống SENTRY_DSN và SENTRY_ENVIRONMENT thì coi như không đặt', () => {
    const env = observabilityEnvSchema.parse({ SENTRY_DSN: '', SENTRY_ENVIRONMENT: '' });
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.SENTRY_ENVIRONMENT).toBeUndefined();
  });

  it('SENTRY_DSN sai định dạng vẫn bị từ chối', () => {
    expect(() => observabilityEnvSchema.parse({ SENTRY_DSN: 'not a url' })).toThrow();
  });

  it('để trống các timeout DB thì dùng mặc định chứ không phải 0', () => {
    const env = databaseEnvSchema.parse({
      DATABASE_URL: url,
      DB_POOL_MAX: '',
      DB_CONNECT_TIMEOUT_MS: '',
      DB_STATEMENT_TIMEOUT_MS: '',
      DB_IDLE_TX_TIMEOUT_MS: '',
    });
    expect(env.DB_POOL_MAX).toBeUndefined();
    expect(env.DB_CONNECT_TIMEOUT_MS).toBeUndefined();
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBeUndefined();
    expect(env.DB_IDLE_TX_TIMEOUT_MS).toBeUndefined();
  });

  it('timeout DB đặt 0 rõ ràng vẫn giữ 0', () => {
    expect(
      databaseEnvSchema.parse({ DATABASE_URL: url, DB_STATEMENT_TIMEOUT_MS: '0' })
        .DB_STATEMENT_TIMEOUT_MS,
    ).toBe(0);
  });

  it('để trống S3_PUBLIC_ENDPOINT thì coi như không đặt', () => {
    expect(s3EnvSchema.shape.S3_PUBLIC_ENDPOINT.parse('')).toBeUndefined();
  });
});
