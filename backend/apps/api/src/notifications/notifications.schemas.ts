import { z } from 'zod';

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z
    .string()
    .describe('comment.mention · comment.new · share.added · video.ready · video.failed'),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.date().nullable(),
  createdAt: z.date(),
});

export const notificationsQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const markReadBody = z
  .object({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() })
  .strict()
  .refine((b) => b.all || b.ids?.length, 'Provide ids or all: true');

export type NotificationsQuery = z.output<typeof notificationsQuery>;
export type MarkReadBody = z.output<typeof markReadBody>;
