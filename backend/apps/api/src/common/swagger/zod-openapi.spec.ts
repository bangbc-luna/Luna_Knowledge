import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toOpenApi } from './zod-openapi.js';

describe('toOpenApi', () => {
  it('renders z.date() as a date-time string', () => {
    expect(toOpenApi(z.object({ at: z.date(), maybe: z.date().nullable() }))).toMatchObject({
      properties: { at: { type: 'string', format: 'date-time' } },
    });
  });
});
