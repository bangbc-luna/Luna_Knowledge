import { z } from 'zod';
import { nodeSchema } from '../content/nodes.schemas.js';
import { userSummarySchema } from '../users/users.schemas.js';

export const previewKindSchema = z
  .enum(['pdf', 'image', 'text', 'none'])
  .describe('Cách FE hiển thị: pdf.js, thẻ <img>, khung chữ, hoặc không có bản xem trước');

export const fileVersionSchema = z.object({
  id: z.uuid(),
  versionNo: z.number().int(),
  fileName: z.string(),
  size: z.number().int(),
  mime: z.string(),
  sha256: z.string().nullable(),
  previewKind: previewKindSchema,
  hasThumbnail: z.boolean(),
  uploadedBy: userSummarySchema,
  createdAt: z.date(),
  isCurrent: z.boolean(),
});

const duplicatesSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(['FILE', 'VIDEO']),
    section: z.enum(['DOCS', 'VIDEOS']),
    workspace: z.object({ id: z.uuid(), name: z.string() }),
  }),
);

export const fileDetailSchema = z.object({
  node: nodeSchema,
  currentVersion: fileVersionSchema.nullable(),
  versionCount: z.number().int(),
  processingError: z.string().nullable().describe('Lý do xử lý lỗi gần nhất (khi FAILED)'),
  canDownload: z.boolean().describe('Video chỉ được xem, không được tải'),
  duplicates: duplicatesSchema.describe(
    'Mục khác có cùng nội dung (SHA-256) mà bạn xem được, tối đa 5; chỉ để cảnh báo',
  ),
});

export const duplicateInfoSchema = z.object({
  status: z.enum(['UPLOADING', 'PROCESSING', 'READY', 'FAILED']),
  duplicates: duplicatesSchema,
});

export const previewSchema = z.object({
  kind: previewKindSchema,
  mime: z.string().nullable(),
  url: z.url().nullable().describe('URL ký sẵn, hết hạn sau 10 phút'),
  expiresAt: z.date().nullable(),
});

export const versionQuery = z.object({
  version: z.uuid().optional().describe('Bỏ trống = phiên bản hiện tại'),
});

export const downloadLinkSchema = z.object({
  url: z.string().describe('Đường dẫn tải (dùng một lần, hết hạn sau 60 giây)'),
  expiresAt: z.date(),
});

export const storageStatsSchema = z.object({
  totalBytes: z.number().int(),
  originalBytes: z.number().int(),
  derivedBytes: z.number().int().describe('Preview, thumbnail (và HLS ở Phase 4)'),
  fileCount: z.number().int(),
  trashBytes: z.number().int().describe('Phần nằm trong thùng rác (đã gồm trong totalBytes)'),
});

export type FileVersionDto = z.output<typeof fileVersionSchema>;
export type VersionQuery = z.output<typeof versionQuery>;
