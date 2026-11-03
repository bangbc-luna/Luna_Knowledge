import { isValidDocJSON } from '@luna/editor';
import { z } from 'zod';

export const MINUTES_DOC_MAX_BYTES = 2 * 1024 * 1024;

export const minutesStatusSchema = z.enum([
  'NONE',
  'RECORDING',
  'PROCESSING',
  'AWAITING_REVIEW',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
]);

const docJsonSchema = z
  .record(z.string(), z.unknown())
  .refine((d) => Buffer.byteLength(JSON.stringify(d)) <= MINUTES_DOC_MAX_BYTES, {
    message: 'The minutes document is too large',
  })
  .refine((d) => isValidDocJSON(d), { message: 'The minutes document is not valid' })
  .describe('Tài liệu ProseMirror JSON theo schema editor, tối đa 2 MB');

const revisionSchema = z.number().int().min(0);

export const mentionSuggestionSchema = z.object({
  actionIndex: z.number().int(),
  name: z.string(),
  userId: z.uuid(),
  userName: z.string(),
});

export const minutesSchema = z.object({
  status: minutesStatusSchema,
  documentNodeId: z
    .uuid()
    .nullable()
    .describe('Chỉ trả khi người xem có quyền đọc tài liệu biên bản'),
  canReview: z.boolean().describe('Người tạo buổi họp hoặc quản trị workspace'),
  error: z.string().nullable().describe('Chỉ có khi status=FAILED và người xem là người duyệt'),
  warning: z
    .string()
    .nullable()
    .describe('Cảnh báo kèm bản nháp khi status=AWAITING_REVIEW, chỉ cho người duyệt'),
  failedStage: z.string().nullable(),
  failureReason: z
    .string()
    .nullable()
    .describe('Lý do lỗi ngắn bằng tiếng Việt khi status=FAILED, cho mọi người xem buổi họp'),
  canRetry: z
    .boolean()
    .describe(
      'Người duyệt có thể chạy lại: false khi không phải FAILED, khi âm thanh đã bị xoá, khi không còn đoạn nào để chép lời, hoặc khi máy chủ chưa cấu hình AI',
    ),
  droppedItemCount: z.number().int(),
  draft: z
    .object({
      doc: z.record(z.string(), z.unknown()),
      revision: z.number().int(),
      suggestions: z.array(mentionSuggestionSchema),
    })
    .nullable()
    .describe('Chỉ cho người duyệt khi status=AWAITING_REVIEW'),
});

export const minutesSummarySchema = z.object({
  status: minutesStatusSchema,
  documentNodeId: z.uuid().nullable(),
});

export const saveDraftBody = z.object({ doc: docJsonSchema, revision: revisionSchema });
export const saveDraftResultSchema = z.object({ revision: z.number().int() });

export const publishBody = z.object({
  revision: revisionSchema,
  confirmedUserIds: z.array(z.uuid()).max(200).default([]),
});
export const publishResultSchema = z.object({ documentNodeId: z.uuid() });

export const retryResultSchema = z.object({ attempt: z.number().int() });

export type SaveDraftBody = z.output<typeof saveDraftBody>;
export type PublishBody = z.output<typeof publishBody>;
export type MinutesSummary = z.output<typeof minutesSummarySchema>;
