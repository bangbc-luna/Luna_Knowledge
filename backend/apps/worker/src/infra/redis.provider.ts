import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type NodeEvent, nodeEventsChannel, notifyChannel } from '@luna/shared';
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

  async publishRaw(channel: string, message: string): Promise<number> {
    return this.redis.publish(channel, message);
  }

  async setIfAbsent(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSec, 'NX');
  }

  async getValue(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async deleteKey(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async notify(row: {
    id: string;
    userId: string;
    type: string;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
  }) {
    const { userId, ...dto } = row;
    await this.redis.publish(notifyChannel(userId), JSON.stringify(dto)).catch(() => 0);
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
