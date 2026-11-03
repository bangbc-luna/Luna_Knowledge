import { notifyChannel } from '@luna/shared';
import type { Prisma, PrismaClient } from './generated/prisma/client.js';

export interface NotificationDto {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export function toNotificationDto(r: {
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

export async function writeNotifications(
  db: Pick<PrismaClient, 'notification'>,
  publish: (channel: string, message: string) => Promise<unknown>,
  userIds: Iterable<string>,
  type: string,
  payload: Prisma.InputJsonObject,
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const rows = await db.notification.createManyAndReturn({
    data: ids.map((userId) => ({ userId, type, payload })),
  });
  await Promise.all(
    rows.map((r) =>
      publish(notifyChannel(r.userId), JSON.stringify(toNotificationDto(r))).catch(() => 0),
    ),
  );
}
