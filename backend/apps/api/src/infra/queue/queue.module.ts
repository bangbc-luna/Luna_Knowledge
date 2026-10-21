import { QUEUES, redisConnection } from '@luna/shared';
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

/** Hàng đợi API đẩy việc sang worker (xử lý file, dọn dẹp). API chỉ thêm job, không xử lý. */
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
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
