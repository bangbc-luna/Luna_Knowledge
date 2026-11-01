import type { OpenAPIObject } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import { renderTypes } from './render-types.js';

const doc = {
  openapi: '3.0.0',
  info: { title: 't', version: '1', description: 'described' },
  paths: {
    '/api/v1/nodes/{id}': {
      get: {
        summary: 'Get node',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'node',
                  properties: { createdAt: { type: 'string', format: 'date-time' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as unknown as OpenAPIObject;

describe('renderTypes', () => {
  it('emits no comments and contains the API path', async () => {
    const out = await renderTypes(doc);
    expect(out).toContain('"/api/v1/nodes/{id}"');
    expect(out).not.toMatch(/^\s*(\/\/|\/\*|\*)/m);
    expect(out.endsWith('\n')).toBe(true);
  });
});
