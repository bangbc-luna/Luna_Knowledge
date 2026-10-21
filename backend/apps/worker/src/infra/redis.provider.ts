import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type NodeEvent, nodeEventsChannel } from '@luna/shared';
import { Redis } from 'ioredis';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';

@Injectable()
export class NodeEventsPublisher implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(WORKER_CONFIG) config: WorkerConfig) {
    this.redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
    this.redis.on('error', () => undefined);
  }

  async publish(event: NodeEvent): Promise<void> {
    await this.redis.publish(nodeEventsChannel(event.nodeId), JSON.stringify(event)).catch(() => 0);
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
