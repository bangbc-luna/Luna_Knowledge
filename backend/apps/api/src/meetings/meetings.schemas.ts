import { z } from 'zod';
import { pageSchema, paginationQuery } from '../common/pagination/cursor.js';
import { userSummarySchema } from '../users/users.schemas.js';

const SCHEDULE_GRACE_MS = 5 * 60_000;

const emailSchema = z.email().transform((v) => v.toLowerCase());
const titleSchema = z.string().trim().min(1).max(200);
const futureDate = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() > Date.now() - SCHEDULE_GRACE_MS, {
    message: 'scheduledAt must not be in the past',
  });

export const createMeetingBody = z
  .object({
    title: titleSchema,
    mode: z.enum(['instant', 'scheduled']),
    scheduledAt: futureDate.optional().describe('Bắt buộc khi mode=scheduled'),
    aiNotesEnabled: z.boolean().default(true),
    inviteeEmails: z.array(emailSchema).max(50).default([]),
  })
  .refine((b) => b.mode === 'instant' || b.scheduledAt !== undefined, {
    message: 'scheduledAt is required for scheduled meetings',
    path: ['scheduledAt'],
  });

export const updateMeetingBody = z.object({
  title: titleSchema.optional(),
  scheduledAt: futureDate.optional(),
  aiNotesEnabled: z.boolean().optional(),
});

export const inviteBody = z.object({ emails: z.array(emailSchema).min(1).max(50) });

export const listMeetingsQuery = paginationQuery.extend({
  scope: z.enum(['upcoming', 'live', 'past']),
});

export const meetingStatusSchema = z.enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']);

export const meetingSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  title: z.string(),
  status: meetingStatusSchema,
  scheduledAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  endedAt: z.date().nullable(),
  aiNotesEnabled: z.boolean(),
  createdBy: userSummarySchema,
  attendeeCount: z.number().int(),
});

export const meetingDetailSchema = meetingSchema.extend({
  invitees: z.array(userSummarySchema),
  attendees: z.array(userSummarySchema.extend({ joinedAt: z.date(), leftAt: z.date().nullable() })),
  opensAt: z
    .date()
    .nullable()
    .describe('Giờ phòng mở cho người không quản lý, chỉ khi buổi họp còn SCHEDULED'),
  canHost: z.boolean().describe('Người tạo buổi họp'),
  canManage: z.boolean().describe('Người tạo hoặc quản trị workspace: sửa, huỷ, mời'),
});

export const meetingPageSchema = pageSchema(meetingSchema);
export const invitesAddedSchema = z.object({ added: z.array(userSummarySchema) });

export type CreateMeetingBody = z.output<typeof createMeetingBody>;
export type UpdateMeetingBody = z.output<typeof updateMeetingBody>;
export type InviteBody = z.output<typeof inviteBody>;
export type ListMeetingsQuery = z.output<typeof listMeetingsQuery>;

export const joinMeetingSchema = z.object({
  serverUrl: z.string(),
  token: z.string(),
  roomName: z.string(),
  identity: z.string(),
  aiNotesEnabled: z.boolean(),
  isHost: z.boolean(),
  expiresInSec: z.number().int(),
});

export const muteResultSchema = z.object({ muted: z.boolean() });

export const handBody = z.object({ raised: z.boolean() });
export const handResultSchema = z.object({ raised: z.boolean() });

export const aiNotesBody = z.object({ enabled: z.boolean() });
export const aiNotesResultSchema = z.object({ aiNotesEnabled: z.boolean() });

export type HandBody = z.output<typeof handBody>;
export type AiNotesBody = z.output<typeof aiNotesBody>;

export const sendMessageBody = z.object({ body: z.string().trim().min(1).max(2000) });
export const listMessagesQuery = paginationQuery;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  body: z.string().describe('Văn bản thuần, lưu nguyên văn: giao diện phải hiển thị như text'),
  createdAt: z.date(),
  author: userSummarySchema,
});
export const chatMessagePageSchema = pageSchema(chatMessageSchema);

export type SendMessageBody = z.output<typeof sendMessageBody>;
export type ListMessagesQuery = z.output<typeof listMessagesQuery>;
export type ChatMessageDto = z.output<typeof chatMessageSchema>;
