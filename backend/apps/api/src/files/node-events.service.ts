import { NODE_EVENTS_PATTERN, type NodeEvent, nodeEventsChannel } from '@luna/shared';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { REDIS } from '../infra/redis/redis.module.js';

/**
 * Trạng thái xử lý node qua Redis pub/sub: worker (hoặc API) publish, SSE `/nodes/:id/events`
 * nhận. Một kết nối subscriber dùng chung cho mọi client, tạo khi có người nghe đầu tiên.
 */
@Injectable()
export class NodeEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(NodeEventsService.name);
  private subscriber?: Redis;
  private readonly listeners = new Map<string, Set<(e: NodeEvent) => void>>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(event: NodeEvent): Promise<void> {
    try {
      await this.redis.publish(nodeEventsChannel(event.nodeId), JSON.stringify(event));
    } catch (err) {
      // Mất sự kiện chỉ làm client chậm cập nhật (vẫn đọc được trạng thái qua GET).
      this.logger.warn({ err }, 'Failed to publish node event');
    }
  }

  stream(nodeId: string): Observable<NodeEvent> {
    return new Observable<NodeEvent>((subscriber) => {
      const listener = (e: NodeEvent) => subscriber.next(e);
      let set = this.listeners.get(nodeId);
      if (!set) this.listeners.set(nodeId, (set = new Set()));
      set.add(listener);
      this.ensureSubscriber();
      return () => {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(nodeId);
      };
    });
  }

  private ensureSubscriber() {
    if (this.subscriber) return;
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('error', () => undefined);
    void this.subscriber.psubscribe(NODE_EVENTS_PATTERN);
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const nodeId = channel.slice(channel.indexOf(':') + 1);
      const set = this.listeners.get(nodeId);
      if (!set) return;
      try {
        const event = JSON.parse(message) as NodeEvent;
        for (const listener of set) listener(event);
      } catch {
        // Bỏ qua tin nhắn hỏng.
      }
    });
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
