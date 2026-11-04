import { collabEnvSchema } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgresql://luna:secret@localhost:5432/luna',
  REDIS_URL: 'redis://localhost:6379',
  COLLAB_TOKEN_SECRET: 'x'.repeat(32),
  COLLAB_INTERNAL_SECRET: 'y'.repeat(32),
};

describe('collabEnvSchema', () => {
  it('production thiếu METRICS_TOKEN thì báo lỗi đúng trường', () => {
    const r = collabEnvSchema.safeParse({ ...base, NODE_ENV: 'production' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('METRICS_TOKEN');
  });

  it('production có METRICS_TOKEN thì hợp lệ', () => {
    const r = collabEnvSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      METRICS_TOKEN: 'z'.repeat(32),
    });
    expect(r.error?.issues ?? []).toEqual([]);
  });

  it('development không cần METRICS_TOKEN', () => {
    const r = collabEnvSchema.safeParse({ ...base, NODE_ENV: 'development' });
    expect(r.error?.issues ?? []).toEqual([]);
  });
});
