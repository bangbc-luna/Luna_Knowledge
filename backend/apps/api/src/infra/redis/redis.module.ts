import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

/** Kết nối Redis dùng cho cache/pub-sub (BullMQ tự quản lý kết nối riêng). */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('Redis');
        const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });
        // Không có listener thì ioredis in "Unhandled error event" ở mỗi lần thử lại.
        // Chỉ log lần mất kết nối đầu tiên và lúc kết nối lại.
        let down = false;
        redis.on('error', (err: Error & { code?: string }) => {
          if (down) return;
          down = true;
          logger.error(`Cannot reach Redis at ${config.REDIS_URL} (${err.code ?? err.message})`);
        });
        redis.on('ready', () => {
          if (down) logger.log('Redis connection restored');
          down = false;
        });
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
