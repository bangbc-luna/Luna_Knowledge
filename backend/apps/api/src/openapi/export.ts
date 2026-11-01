import 'reflect-metadata';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { renderTypes } from './render-types.js';

const placeholderSecrets: Record<string, string> = {
  VIDEO_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
  COLLAB_TOKEN_SECRET: 'openapi-export-placeholder-collab-token-secret',
  COLLAB_INTERNAL_SECRET: 'openapi-export-placeholder-collab-internal-secret',
  JWT_ACCESS_SECRET: 'openapi-export-placeholder-jwt-access-secret',
  GOOGLE_CLIENT_ID: 'openapi-export-placeholder-client-id',
  GOOGLE_CLIENT_SECRET: 'openapi-export-placeholder-client-secret',
};

for (const [key, value] of Object.entries(placeholderSecrets)) {
  if (!process.env[key]) process.env[key] = value;
}

const { AppModule } = await import('../app.module.js');
const { buildOpenApiDocument } = await import('../common/swagger/openapi-document.js');
const { loadAppConfig } = await import('../config/app-config.js');
const { applyGlobalPrefix } = await import('../setup-app.js');

const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../frontend/src/lib/api-schema.ts',
);

const mode = process.argv[2];
if (mode !== '--write' && mode !== '--check') {
  console.error('usage: export.js --write | --check');
  process.exit(2);
}

const app = await NestFactory.create(AppModule, { preview: true, logger: false });
applyGlobalPrefix(app);
const rendered = await renderTypes(buildOpenApiDocument(app, loadAppConfig()));
await app.close();

if (mode === '--write') {
  await writeFile(target, rendered);
} else {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error('api-schema.ts is out of date, run pnpm --filter @luna/api openapi:types');
    process.exit(1);
  }
}
process.exit(0);
