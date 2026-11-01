import type { OpenAPIObject } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';
import { renderTypes, stripDocs } from './render-types.js';

const doc = {
  openapi: '3.0.0',
  info: { title: 't', version: '1', description: 'described-info-text' },
  paths: {
    '/api/v1/nodes/{id}': {
      get: {
        summary: 'summary-text',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'described-node-text',
                  example: { createdAt: 'example-value' },
                  properties: {
                    createdAt: { type: 'string', format: 'date-time' },
                    description: { type: 'string', nullable: true, description: 'doc' },
                  },
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

  it('keeps properties that are named like documentation keys', async () => {
    const out = await renderTypes(doc);
    expect(out).toContain('description?: string | null;');
  });

  it('strips documentation keys that sit outside properties', async () => {
    const out = await renderTypes(doc);
    for (const text of [
      'described-info-text',
      'described-node-text',
      'summary-text',
      'example-value',
    ]) {
      expect(out).not.toContain(text);
    }
    expect(JSON.stringify(stripDocs(doc))).not.toMatch(
      /described-|summary-text|example-value|"doc"/,
    );
  });
});
