import { QUEUES, redisConnection } from '@luna/shared';
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { SearchQueueService } from './search-queue.service.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: redisConnection(config.REDIS_URL),
        prefix: 'luna',
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUES.FILE_PROCESS },
      { name: QUEUES.MAINTENANCE },
      { name: QUEUES.VIDEO_TRANSCODE },
      { name: QUEUES.SEARCH_INDEX },
    ),
  ],
  providers: [SearchQueueService],
  exports: [BullModule, SearchQueueService],
})
export class QueueModule {}
