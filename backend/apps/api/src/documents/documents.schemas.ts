import { z } from 'zod';
import { nodeNameSchema } from '../content/node-names.js';
import { nodeSchema } from '../content/nodes.schemas.js';
import { userSummarySchema } from '../users/users.schemas.js';

export const documentFormatSchema = z.enum(['RICH', 'LATEX']);

export const createDocumentBody = z
  .object({
    parentId: z.uuid().nullable().optional().describe('Bỏ trống = gốc workspace'),
    name: nodeNameSchema,
    format: documentFormatSchema
      .default('RICH')
      .describe('RICH = văn bản (Tiptap), LATEX = mã nguồn LaTeX có xem trước'),
  })
  .strict();

export const copyDocumentBody = z
  .object({
    workspaceId: z
      .uuid()
      .optional()
      .describe('Workspace đích; bỏ trống = cùng workspace với bản gốc'),
    parentId: z
      .uuid()
      .nullable()
      .optional()
      .describe(
        'Folder đích; bỏ trống = cùng folder với bản gốc (hoặc gốc workspace đích), null = gốc',
      ),
    name: nodeNameSchema.optional().describe('Bỏ trống = "<tên gốc> (bản sao)"'),
  })
  .strict();

export type CopyDocumentBody = z.output<typeof copyDocumentBody>;

export const documentSchema = z.object({
  node: nodeSchema,
  format: documentFormatSchema,
  contentJson: z
    .unknown()
    .describe(
      'Tiptap JSON (RICH) hoặc `{type: "latex", source}` (LATEX), để hiển thị nhanh khi chưa kết nối collab',
    ),
  wordCount: z.number().int(),
  lastEditedAt: z.date().nullable(),
  lastEditedBy: userSummarySchema.nullable(),
  versionCount: z.number().int(),
  readOnly: z.boolean(),
});

export const collabTokenSchema = z.object({
  token: z.string(),
  documentName: z.string(),
  url: z.string().describe('Địa chỉ WebSocket của collab server'),
  readOnly: z.boolean(),
  expiresAt: z.date(),
  user: z.object({ id: z.uuid(), name: z.string() }),
});

export const exportQuery = z.object({
  format: z
    .enum(['html', 'md', 'tex'])
    .default('html')
    .describe('`tex` chỉ dùng cho tài liệu LaTeX'),
});

export const assetSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  mime: z.string(),
  size: z.number().int(),
  url: z.url().describe('URL ký sẵn 10 phút'),
  isImage: z.boolean(),
});

export const versionSummarySchema = z.object({
  id: z.uuid(),
  versionNo: z.number().int(),
  name: z.string().nullable(),
  isAuto: z.boolean(),
  restoredFrom: z.object({ id: z.uuid(), versionNo: z.number().int() }).nullable(),
  wordCount: z.number().int(),
  wordsAdded: z.number().int().describe('Số từ thêm so với phiên bản trước'),
  wordsRemoved: z.number().int().describe('Số từ bớt so với phiên bản trước'),
  createdBy: userSummarySchema.nullable(),
  createdAt: z.date(),
});

export const versionDetailSchema = versionSummarySchema.extend({
  contentJson: z.unknown(),
  html: z.string(),
});

export const createVersionBody = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export const diffQuery = z.object({
  with: z
    .string()
    .default('current')
    .describe('ID phiên bản khác, hoặc "current" = nội dung hiện tại'),
});

export const diffSchema = z.object({
  from: z.object({ id: z.uuid(), versionNo: z.number().int() }),
  to: z.object({ id: z.string(), versionNo: z.number().int().nullable() }),
  stats: z.object({ added: z.number().int(), removed: z.number().int() }),
  parts: z.array(z.object({ type: z.enum(['same', 'added', 'removed']), text: z.string() })),
});

export type CreateDocumentBody = z.output<typeof createDocumentBody>;
export type DiffQuery = z.output<typeof diffQuery>;
