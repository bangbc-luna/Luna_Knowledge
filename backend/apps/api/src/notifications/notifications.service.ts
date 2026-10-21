import { NOTIFY_PATTERN, notifyChannel } from '@luna/shared';
import type { Prisma } from '@luna/db';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { toPage } from '../common/pagination/cursor.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import type { MarkReadBody, NotificationsQuery } from './notifications.schemas.js';

export interface NotificationDto {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private subscriber?: Redis;
  private readonly listeners = new Map<string, Set<(n: NotificationDto) => void>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async notify(
    userIds: Iterable<string>,
    type: string,
    payload: Prisma.InputJsonObject,
  ): Promise<void> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    try {
      const rows = await this.prisma.client.notification.createManyAndReturn({
        data: ids.map((userId) => ({ userId, type, payload })),
      });
      await Promise.all(
        rows.map((r) =>
          this.redis.publish(notifyChannel(r.userId), JSON.stringify(this.toDto(r))).catch(() => 0),
        ),
      );
    } catch (err) {
      this.logger.error({ err, type }, 'Failed to create notifications');
    }
  }

  async list(userId: string, q: NotificationsQuery) {
    const rows = await this.prisma.client.notification.findMany({
      where: { userId, ...(q.unread === 'true' ? { readAt: null } : {}) },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const unreadCount = await this.prisma.client.notification.count({
      where: { userId, readAt: null },
    });
    return {
      ...toPage(
        rows.map((r) => this.toDto(r)),
        q.limit,
      ),
      unreadCount,
    };
  }

  async markRead(userId: string, body: MarkReadBody) {
    const { count } = await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  stream(userId: string): Observable<NotificationDto> {
    return new Observable<NotificationDto>((subscriber) => {
      const listener = (n: NotificationDto) => subscriber.next(n);
      let set = this.listeners.get(userId);
      if (!set) this.listeners.set(userId, (set = new Set()));
      set.add(listener);
      this.ensureSubscriber();
      return () => {
        set.delete(listener);
        if (!set.size) this.listeners.delete(userId);
      };
    });
  }

  private ensureSubscriber() {
    if (this.subscriber) return;
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('error', () => undefined);
    void this.subscriber.psubscribe(NOTIFY_PATTERN);
    this.subscriber.on('pmessage', (_p: string, channel: string, message: string) => {
      const set = this.listeners.get(channel.slice(channel.indexOf(':') + 1));
      if (!set) return;
      try {
        const n = JSON.parse(message) as NotificationDto;
        for (const l of set) l(n);
      } catch {
        return;
      }
    });
  }

  private toDto(r: {
    id: string;
    type: string;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationDto {
    return {
      id: r.id,
      type: r.type,
      payload: r.payload as Record<string, unknown>,
      readAt: r.readAt,
      createdAt: r.createdAt,
    };
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
