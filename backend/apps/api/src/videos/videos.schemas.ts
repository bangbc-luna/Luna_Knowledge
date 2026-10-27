import { z } from 'zod';
import { nodeDescriptionSchema, nodeTitleSchema } from '../content/node-names.js';
import { nodeSchema } from '../content/nodes.schemas.js';

export const renditionSchema = z.object({
  name: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bandwidth: z.number().int(),
});

export const videoDetailSchema = z.object({
  node: nodeSchema,
  video: z
    .object({
      durationSec: z.number(),
      width: z.number().int(),
      height: z.number().int(),
      renditions: z.array(renditionSchema),
      viewCount: z.number().int(),
      transcodedAt: z.date(),
    })
    .nullable()
    .describe('null khi chưa transcode xong lần nào'),
  processingError: z.string().nullable(),
  resumeAt: z.number().nullable().describe('Vị trí đang xem dở của bạn (giây)'),
});

export const playbackSchema = z.object({
  masterUrl: z
    .string()
    .describe('Đưa cho hls.js. Phiên xem tự gia hạn khi đang phát, hết hạn sau 15 phút không dùng'),
  token: z.string(),
  expiresAt: z.date(),
  posterUrl: z.url().nullable(),
  watermark: z.object({ name: z.string(), email: z.string() }).describe('FE vẽ kèm giờ hiện tại'),
  resumeAt: z.number().nullable(),
  durationSec: z.number(),
});

export const sessionQuery = z.object({ s: z.string().min(16).max(128) });
export const progressBody = z
  .object({
    positionSec: z
      .number()
      .min(0)
      .max(24 * 3600),
  })
  .strict();

export const adminVideoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['UPLOADING', 'PROCESSING', 'READY', 'FAILED']),
  workspace: z.object({ id: z.uuid(), name: z.string() }),
  size: z.number().int().nullable(),
  durationSec: z.number().nullable(),
  viewCount: z.number().int(),
  createdBy: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  createdAt: z.date(),
});
export const adminVideosQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type SessionQuery = z.output<typeof sessionQuery>;
export type AdminVideosQuery = z.output<typeof adminVideosQuery>;

export const videoInfoBody = z
  .object({
    title: nodeTitleSchema.describe('Tiêu đề, cũng là tên mục'),
    description: nodeDescriptionSchema,
  })
  .strict();
