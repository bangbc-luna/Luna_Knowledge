import { z } from 'zod';
import { paginationQuery } from '../common/pagination/cursor.js';

export const workspaceRoleSchema = z.enum(['MEMBER']);
export const contentRoleSchema = z.enum(['VIEWER', 'EDITOR', 'OWNER']);

export const userSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

export const meSchema = userSummarySchema.extend({
  isSystemAdmin: z.boolean(),
  workspaces: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
      icon: z.string().nullable(),
      role: workspaceRoleSchema,
    }),
  ),
});

export const searchUsersQuery = z.object({
  q: z.string().trim().min(1).max(100).describe('Tìm theo tên hoặc email'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const adminUserSchema = userSummarySchema.extend({
  isSystemAdmin: z.boolean(),
  status: z.enum(['ACTIVE', 'DISABLED']),
  lastLoginAt: z.date().nullable(),
  createdAt: z.date(),
});

export const adminListUsersQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export const adminUpdateUserBody = z
  .object({
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    isSystemAdmin: z.boolean().optional(),
  })
  .refine((v) => v.status !== undefined || v.isSystemAdmin !== undefined, {
    message: 'Provide at least one field',
  });

export type AdminListUsersQuery = z.output<typeof adminListUsersQuery>;
export type AdminUpdateUserBody = z.output<typeof adminUpdateUserBody>;
