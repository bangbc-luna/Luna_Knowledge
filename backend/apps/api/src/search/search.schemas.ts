import { z } from 'zod';
import { nodeSchema, nodeTypeSchema, sectionSchema } from '../content/nodes.schemas.js';

const csvUuids = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const ids = (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of ids) {
      if (!z.uuid().safeParse(id).success) {
        ctx.addIssue({ code: 'custom', message: `Invalid tag id "${id}"` });
        return z.NEVER;
      }
    }
    return ids;
  });

export const searchQuery = z.object({
  q: z.string().trim().min(1).max(200).describe('Từ khoá; có dấu hay không dấu đều được'),
  workspaceId: z.uuid().optional(),
  section: sectionSchema.optional(),
  type: nodeTypeSchema.optional(),
  tagIds: csvUuids.describe('Danh sách tag id, cách nhau bằng dấu phẩy; mục phải có đủ các tag'),
  createdBy: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional().describe('Sửa lần cuối từ (ISO 8601)'),
  to: z.iso.datetime({ offset: true }).optional().describe('Sửa lần cuối đến (ISO 8601)'),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const partSchema = z.object({ text: z.string(), match: z.boolean() });

export const searchResultSchema = z.object({
  items: z.array(
    z.object({
      node: nodeSchema,
      workspace: z.object({ id: z.uuid(), name: z.string() }),
      path: z.array(z.string()).describe('Tên các thư mục cha, từ gốc khu xuống'),
      name: z.array(partSchema).describe('Tên, tách đoạn khớp để tô đậm'),
      snippet: z.array(partSchema).nullable().describe('Đoạn trích nội dung quanh chỗ khớp'),
      matchedIn: z.enum(['name', 'content', 'tags']),
    }),
  ),
  total: z.number().int().describe('Ước lượng tổng số kết quả'),
  nextCursor: z.string().nullable(),
});

export type SearchQuery = z.output<typeof searchQuery>;
export type SearchPart = z.output<typeof partSchema>;
