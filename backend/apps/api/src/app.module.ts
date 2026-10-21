import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ContentModule } from './content/content.module.js';
import { APP_CONFIG, type AppConfig, loadAppConfig } from './config/app-config.js';
import { ConfigModule } from './config/config.module.js';
import { loggerParams } from './config/logger.js';
import { DevModule } from './dev/dev.module.js';
import { FilesModule } from './files/files.module.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { S3Module } from './infra/s3/s3.module.js';
import { VideosModule } from './videos/videos.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

const isDevelopment = loadAppConfig().NODE_ENV === 'development';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => loggerParams(config),
    }),
    PrismaModule,
    RedisModule,
    S3Module,
    QueueModule,
    AuditModule,
    AuthModule,
    HealthModule,
    UsersModule,
    WorkspacesModule,
    ContentModule,
    FilesModule,
    VideosModule,
    AdminModule,
    ...(isDevelopment ? [DevModule] : []),
  ],
})
export class AppModule {}
