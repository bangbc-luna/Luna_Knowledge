import { type INestApplication, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { MetricsService } from './infra/metrics/metrics.service.js';
import type { Express } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from './config/app-config.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

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

  if (!config.SWAGGER_ENABLED) return;
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Luna Knowledge API')
      .setDescription('Backend API cho hệ thống lưu trữ tài liệu và video. Xem docs/SPEC.md.')
      .setVersion('0.1.0')
      .addServer(config.API_PUBLIC_URL)
      .addBearerAuth()
      .addCookieAuth('luna_rt')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
}
