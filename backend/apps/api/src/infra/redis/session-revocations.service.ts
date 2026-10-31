import { SESSION_REVOKED_CHANNEL } from '@luna/shared';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { REDIS } from './redis.token.js';

@Injectable()
export class SessionRevocationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionRevocationsService.name);
  private subscriber?: Redis;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleInit() {
    this.ensureSubscriber();
  }

  async publish(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    await this.redis
      .publish(SESSION_REVOKED_CHANNEL, JSON.stringify(sessionIds))
      .catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to publish session revocation');
      });
  }

  revoked$(sessionId: string): Observable<void> {
    return new Observable<void>((subscriber) => {
      const listener = () => {
        subscriber.next();
        subscriber.complete();
      };
      let set = this.listeners.get(sessionId);
      if (!set) this.listeners.set(sessionId, (set = new Set()));
      set.add(listener);
      this.ensureSubscriber();
      return () => {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(sessionId);
      };
    });
  }

  private ensureSubscriber() {
    if (this.subscriber) return;
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('error', () => undefined);
    void this.subscriber.subscribe(SESSION_REVOKED_CHANNEL).catch(() => undefined);
    this.subscriber.on('message', (_channel: string, message: string) => {
      let ids: unknown;
      try {
        ids = JSON.parse(message);
      } catch {
        return;
      }
      if (!Array.isArray(ids)) return;
      for (const id of ids) {
        const set = typeof id === 'string' ? this.listeners.get(id) : undefined;
        if (!set) continue;
        for (const listener of set) listener();
      }
    });
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
