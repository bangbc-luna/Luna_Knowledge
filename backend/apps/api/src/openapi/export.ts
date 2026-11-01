import 'reflect-metadata';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { buildOpenApiDocument } from '../common/swagger/openapi-document.js';
import { loadAppConfig } from '../config/app-config.js';
import { applyGlobalPrefix } from '../setup-app.js';
import { renderTypes } from './render-types.js';

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
