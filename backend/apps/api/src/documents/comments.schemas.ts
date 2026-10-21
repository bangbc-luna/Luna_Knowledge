import { z } from 'zod';
import { userSummarySchema } from '../users/users.schemas.js';

const body = z.string().trim().min(1).max(5000);
const mentions = z
  .array(z.uuid())
  .max(20)
  .default([])
  .describe('ID người được @nhắc (phải xem được tài liệu)');

export const createThreadBody = z
  .object({ quotedText: z.string().trim().max(500).default(''), body, mentions })
  .strict();
export const replyBody = z.object({ body, mentions }).strict();
export const editCommentBody = z.object({ body }).strict();
export const threadsQuery = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'ALL']).default('OPEN'),
});

export const commentSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  author: userSummarySchema,
  mentions: z.array(userSummarySchema),
  createdAt: z.date(),
  editedAt: z.date().nullable(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});

export const threadSchema = z.object({
  id: z.uuid(),
  quotedText: z.string(),
  status: z.enum(['OPEN', 'RESOLVED']),
  createdBy: userSummarySchema,
  createdAt: z.date(),
  resolvedBy: userSummarySchema.nullable(),
  resolvedAt: z.date().nullable(),
  comments: z.array(commentSchema),
  canResolve: z.boolean(),
});

export const createdThreadSchema = threadSchema.extend({
  ignoredMentions: z.array(z.uuid()).describe('Người không xem được tài liệu nên không được nhắc'),
});

export type CreateThreadBody = z.output<typeof createThreadBody>;
export type ReplyBody = z.output<typeof replyBody>;
export type ThreadsQuery = z.output<typeof threadsQuery>;
