import { z } from 'zod';
import { nodeNameSchema } from '../content/node-names.js';

export const createUploadBody = z
  .object({
    parentId: z.uuid().nullable().optional().describe('Folder đích; bỏ trống = gốc workspace'),
    fileName: nodeNameSchema.describe('Tên file, cũng là tên mục sẽ tạo'),
    size: z.number().int().positive().describe('Kích thước (byte)'),
    mime: z.string().max(255).default('application/octet-stream').describe('MIME trình duyệt báo'),
    kind: z.enum(['FILE', 'VIDEO']).default('FILE'),
    replaceNodeId: z
      .uuid()
      .optional()
      .describe('Tải phiên bản mới cho một file đã có (bỏ qua parentId)'),
  })
  .strict();

export const partUrlSchema = z.object({ partNumber: z.number().int(), url: z.url() });

export const uploadSchema = z.object({
  uploadId: z.uuid(),
  nodeId: z.uuid(),
  fileName: z.string(),
  size: z.number().int(),
  kind: z.enum(['FILE', 'VIDEO']),
  isNewVersion: z.boolean(),
  status: z.enum(['PENDING', 'COMPLETED', 'ABORTED']),
  partSize: z.number().int(),
  partCount: z.number().int(),
  expiresAt: z.date(),
});

export const createdUploadSchema = uploadSchema.extend({
  parts: z
    .array(partUrlSchema)
    .describe('URL ký sẵn (1 giờ) cho tối đa 100 part đầu; lấy thêm qua /parts'),
});

export const uploadStatusSchema = uploadSchema.extend({
  uploadedParts: z.array(
    z.object({ partNumber: z.number().int(), size: z.number().int(), etag: z.string() }),
  ),
  uploadedBytes: z.number().int(),
});

export const partsQuery = z.object({
  from: z.coerce.number().int().min(1).default(1),
  to: z.coerce.number().int().min(1).optional().describe('Mặc định from + 99'),
});

export const completeUploadBody = z
  .object({
    parts: z
      .array(z.object({ partNumber: z.number().int().min(1), etag: z.string() }))
      .optional()
      .describe('Không bắt buộc: server tự đối chiếu với các part S3 đã nhận'),
  })
  .strict();

export type CreateUploadBody = z.output<typeof createUploadBody>;
export type PartsQuery = z.output<typeof partsQuery>;
