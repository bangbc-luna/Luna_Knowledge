import 'reflect-metadata';
import { initSentry } from '@luna/shared';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { setupApp } from './setup-app.js';
import { warnIfDependenciesDown } from './startup-check.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get<AppConfig>(APP_CONFIG);
  initSentry('api', config);
  setupApp(app, config);
  await app.listen(config.API_PORT);
  const logger = app.get(Logger);
  logger.log(`API listening on ${config.API_PUBLIC_URL} (docs: /api/docs)`);
  await warnIfDependenciesDown(app, logger);
}

await bootstrap();
