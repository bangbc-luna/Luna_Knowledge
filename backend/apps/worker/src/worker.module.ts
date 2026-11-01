import { ObjectStore, QUEUES } from '@luna/shared';
import { BullModule } from '@nestjs/bullmq';
import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import {
  loadWorkerConfig,
  redisConnection,
  WORKER_CONFIG,
  type WorkerConfig,
} from './config/worker-config.js';
import { MetricsServer } from './infra/metrics.server.js';
import { PrismaService } from './infra/prisma.provider.js';
import { NodeEventsPublisher } from './infra/redis.provider.js';
import { FileProcessProcessor } from './processors/file-process.processor.js';
import { VideoTranscodeProcessor } from './processors/video-transcode.processor.js';
import { MaintenanceProcessor } from './processors/maintenance.processor.js';
import { SearchIndexProcessor } from './processors/search-index.processor.js';
import { SystemProcessor } from './processors/system.processor.js';

@Global()
@Module({
  providers: [{ provide: WORKER_CONFIG, useFactory: () => loadWorkerConfig() }],
  exports: [WORKER_CONFIG],
})
class WorkerConfigModule {}

@Module({
  imports: [
    WorkerConfigModule,
    LoggerModule.forRootAsync({
      inject: [WORKER_CONFIG],
      useFactory: (config: WorkerConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          transport:
            config.NODE_ENV === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
                }
              : undefined,
        },
      }),
    }),
    BullModule.forRootAsync({
      inject: [WORKER_CONFIG],
      useFactory: (config: WorkerConfig) => ({
        connection: redisConnection(config.REDIS_URL),
        prefix: 'luna',
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUES.SYSTEM },
      { name: QUEUES.MAINTENANCE },
      { name: QUEUES.FILE_PROCESS },
      { name: QUEUES.VIDEO_TRANSCODE },
      { name: QUEUES.SEARCH_INDEX },
    ),
  ],
  providers: [
    PrismaService,
    {
      provide: ObjectStore,
      inject: [WORKER_CONFIG],
      useFactory: (c: WorkerConfig) => new ObjectStore(c),
    },
    NodeEventsPublisher,
    SystemProcessor,
    MaintenanceProcessor,
    FileProcessProcessor,
    VideoTranscodeProcessor,
    SearchIndexProcessor,
    MetricsServer,
  ],
})
export class WorkerModule implements OnModuleDestroy {
  constructor(private readonly store: ObjectStore) {}

  onModuleDestroy() {
    this.store.destroy();
  }
}
