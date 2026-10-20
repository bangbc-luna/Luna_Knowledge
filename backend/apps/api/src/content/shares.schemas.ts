import { z } from 'zod';
import { userSummarySchema } from '../users/users.schemas.js';

export const shareRoleSchema = z.enum(['EDITOR', 'VIEWER']);

export const createShareBody = z.object({
  email: z
    .email()
    .transform((v) => v.toLowerCase())
    .describe('Email @lunatech.vn (kể cả người ngoài workspace; chưa đăng nhập lần nào cũng được)'),
  role: shareRoleSchema,
});

export const updateShareBody = z.object({ role: shareRoleSchema });

export const shareSchema = z.object({
  id: z.uuid(),
  user: userSummarySchema,
  role: shareRoleSchema,
  grantedBy: userSummarySchema.nullable(),
  createdAt: z.date(),
});

export const nodeSharesSchema = z.object({
  direct: z.array(shareSchema).describe('Share đặt trực tiếp trên mục này'),
  inherited: z
    .array(shareSchema.extend({ fromNode: z.object({ id: z.uuid(), name: z.string() }) }))
    .describe('Share kế thừa từ các folder cha'),
});

export type CreateShareBody = z.output<typeof createShareBody>;
