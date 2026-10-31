import { z } from 'zod';
import { observabilityEnvSchema, requireMetricsTokenInProduction } from './observability.js';

describe('requireMetricsTokenInProduction', () => {
  const schema = observabilityEnvSchema
    .extend({ NODE_ENV: z.string() })
    .superRefine(requireMetricsTokenInProduction);

  it('production thiếu METRICS_TOKEN thì lỗi, dev/test không bắt buộc', () => {
    expect(schema.safeParse({ NODE_ENV: 'production' }).success).toBe(false);
    expect(
      schema.safeParse({ NODE_ENV: 'production', METRICS_TOKEN: 'x'.repeat(32) }).success,
    ).toBe(true);
    expect(schema.safeParse({ NODE_ENV: 'development' }).success).toBe(true);
    expect(schema.safeParse({ NODE_ENV: 'test' }).success).toBe(true);
  });

  it('báo lỗi tại METRICS_TOKEN với đúng thông điệp', () => {
    const result = schema.safeParse({ NODE_ENV: 'production' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['METRICS_TOKEN']);
      expect(result.error.issues[0]?.message).toBe('METRICS_TOKEN is required in production');
    }
  });
});
