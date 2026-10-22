import 'reflect-metadata';
import { initSentry, loadEnv, observabilityEnvSchema } from '@luna/shared';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

initSentry('worker', { ...loadEnv(observabilityEnvSchema), NODE_ENV: process.env.NODE_ENV });
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
app.get(Logger).log('Worker started');
