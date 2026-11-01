import type { OpenAPIObject } from '@nestjs/swagger';
import openapiTS, { astToString } from 'openapi-typescript';

const DOC_KEYS = new Set(['description', 'summary', 'example', 'examples']);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !DOC_KEYS.has(key))
      .map(([key, child]) => [key, strip(child)]),
  );
}

export function stripDocs(doc: OpenAPIObject): OpenAPIObject {
  return strip(doc) as OpenAPIObject;
}

const JSDOC_BLOCK = /^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*\r?\n/gm;

export async function renderTypes(doc: OpenAPIObject): Promise<string> {
  const out = astToString(await openapiTS(stripDocs(doc) as never)).replace(JSDOC_BLOCK, '');
  return out.endsWith('\n') ? out : `${out}\n`;
}
