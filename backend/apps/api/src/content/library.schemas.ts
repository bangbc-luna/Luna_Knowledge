import { z } from 'zod';
import { nodeSchema } from './nodes.schemas.js';

export const createTagBody = z.object({
  name: z.string().trim().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex code like #1f6feb')
    .transform((v) => v.toLowerCase()),
});

export const updateTagBody = createTagBody
  .partial()
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    message: 'Provide at least one field',
  });

export const setNodeTagsBody = z.object({
  tagIds: z.array(z.uuid()).max(20).describe('Thay toàn bộ tag của mục bằng danh sách này'),
});

export const tagDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  createdAt: z.date(),
});

export const recentSchema = z.object({ node: nodeSchema, viewedAt: z.date() });

export type CreateTagBody = z.output<typeof createTagBody>;
export type UpdateTagBody = z.output<typeof updateTagBody>;
