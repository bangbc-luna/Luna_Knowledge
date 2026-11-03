import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { initSentry, loadEnv, observabilityEnvSchema } from '@luna/shared';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadRecorderConfig } from './config.js';
import { RecorderModule } from './recorder.module.js';

initSentry('recorder', { ...loadEnv(observabilityEnvSchema), NODE_ENV: process.env.NODE_ENV });
await mkdir(loadRecorderConfig().RECORDER_TMP_DIR, { recursive: true });
const app = await NestFactory.createApplicationContext(RecorderModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
app.get(Logger).log('Recorder started');
