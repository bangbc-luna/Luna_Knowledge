import type { Server } from 'node:http';
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { MetricsService } from './infra/metrics/metrics.service.js';
import type { Express } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from './config/app-config.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { buildOpenApiDocument } from './common/swagger/openapi-document.js';

export const API_PREFIX = 'api/v1';

export function setupApp(app: INestApplication, config: AppConfig) {
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
      { path: 'dev/login', method: RequestMethod.GET },
      { path: 'dev/player', method: RequestMethod.GET },
    ],
  });
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', config.TRUST_PROXY);
  app.use(app.get(MetricsService).middleware());
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginEmbedderPolicy: false,
    }),
  );
  (app as NestExpressApplication).useBodyParser('json', { limit: config.BODY_LIMIT });
  (app as NestExpressApplication).useBodyParser('urlencoded', {
    limit: config.BODY_LIMIT,
    extended: true,
  });
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();
  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = config.HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = config.HTTP_KEEP_ALIVE_TIMEOUT_MS + 1000;

  if (!config.SWAGGER_ENABLED) return;
  const document = buildOpenApiDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
}
