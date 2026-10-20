import { type INestApplication, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import type { AppConfig } from './config/app-config.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

export const API_PREFIX = 'api/v1';

/** Cấu hình dùng chung cho main.ts và e2e test, để test chạy đúng như production. */
export function setupApp(app: INestApplication, config: AppConfig) {
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'dev/login', method: RequestMethod.GET },
    ],
  });
  // IP thật của client khi chạy sau Traefik/cloudflared (dùng cho session và audit log).
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', config.TRUST_PROXY);
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();

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
