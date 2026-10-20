import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

// Worker không mở cổng HTTP: chỉ tiêu thụ job từ Redis. Tắt bằng SIGTERM sẽ chờ job đang chạy xong.
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
app.get(Logger).log('Worker started');
