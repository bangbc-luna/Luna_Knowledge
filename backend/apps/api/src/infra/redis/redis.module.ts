import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { CollabEventsService } from './collab-events.service.js';

import { REDIS } from './redis.token.js';

export { REDIS };

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('Redis');
        const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });
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
    CollabEventsService,
  ],
  exports: [REDIS, CollabEventsService],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
