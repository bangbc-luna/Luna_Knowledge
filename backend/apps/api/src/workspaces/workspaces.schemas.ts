import { z } from 'zod';
import { userSummarySchema, workspaceRoleSchema } from '../users/users.schemas.js';

/** Vai trò gán được trực tiếp; OWNER chỉ đổi qua chuyển quyền sở hữu. */
export const assignableRoleSchema = z.enum(['ADMIN', 'EDITOR', 'VIEWER']);

const slug = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens only');

export const createWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slug.describe('Định danh trong URL, ví dụ "marketing"'),
  description: z.string().trim().max(500).optional(),
  icon: z.string().max(16).optional().describe('Emoji hoặc mã icon'),
  ownerEmail: z
    .email()
    .transform((v) => v.toLowerCase())
    .describe('Email @lunatech.vn; user chưa đăng nhập lần nào sẽ được tạo trước'),
});

export const updateWorkspaceBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    icon: z.string().max(16).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });

export const listWorkspacesQuery = z.object({
  scope: z
    .enum(['mine', 'all'])
    .default('mine')
    .describe('`all` chỉ dành cho System Admin: mọi workspace'),
});

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  createdAt: z.date(),
  memberCount: z.number().int(),
  myRole: workspaceRoleSchema.nullable().describe('null: System Admin không phải thành viên'),
  owner: userSummarySchema
    .nullable()
    .optional()
    .describe('Chủ sở hữu (có trong danh sách workspace)'),
});

export const addMemberBody = z.object({
  email: z
    .email()
    .transform((v) => v.toLowerCase())
    .describe('Email @lunatech.vn; user chưa đăng nhập lần nào sẽ được tạo trước'),
  role: assignableRoleSchema,
});

export const updateMemberBody = z.object({ role: assignableRoleSchema });

export const transferOwnershipBody = z.object({
  userId: z.uuid().describe('Thành viên hiện tại sẽ trở thành OWNER; OWNER cũ thành ADMIN'),
});

export const memberSchema = z.object({
  user: userSummarySchema,
  role: workspaceRoleSchema,
  createdAt: z.date(),
});

export type CreateWorkspaceBody = z.output<typeof createWorkspaceBody>;
export type UpdateWorkspaceBody = z.output<typeof updateWorkspaceBody>;
export type AddMemberBody = z.output<typeof addMemberBody>;
export type UpdateMemberBody = z.output<typeof updateMemberBody>;
