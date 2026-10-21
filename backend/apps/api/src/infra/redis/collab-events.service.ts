import { COLLAB_ACCESS_CHANNEL, type CollabAccessEvent } from '@luna/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from './redis.token.js';

@Injectable()
export class CollabEventsService {
  private readonly logger = new Logger(CollabEventsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async accessChanged(event: CollabAccessEvent): Promise<void> {
    await this.redis.publish(COLLAB_ACCESS_CHANNEL, JSON.stringify(event)).catch((err: unknown) => {
      this.logger.warn({ err }, 'Failed to publish collab access event');
    });
  }
}
