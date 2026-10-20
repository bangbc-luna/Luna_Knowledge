import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({ name: z.string().min(1), limit: z.coerce.number().max(200).default(50) }),
  );

  it('trả dữ liệu đã parse và áp default', () => {
    expect(pipe.transform({ name: 'Docs' })).toEqual({ name: 'Docs', limit: 50 });
  });

  it('ném AppError VALIDATION_ERROR kèm từng trường lỗi', () => {
    try {
      pipe.transform({ name: '', limit: 500 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
      expect((err as AppError).details).toEqual([
        { path: 'name', message: expect.any(String) },
        { path: 'limit', message: expect.any(String) },
      ]);
    }
  });
});
