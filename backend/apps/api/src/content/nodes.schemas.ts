import { z } from 'zod';
import { userSummarySchema, contentRoleSchema } from '../users/users.schemas.js';
import { nodeNameSchema } from './node-names.js';

export const sectionSchema = z.enum(['DOCS', 'VIDEOS']);

export const nodeTypeSchema = z.enum(['FOLDER', 'DOCUMENT', 'FILE', 'VIDEO']);

export const tagSchema = z.object({ id: z.uuid(), name: z.string(), color: z.string() });

export const nodeSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  parentId: z.uuid().nullable(),
  type: nodeTypeSchema,
  name: z.string(),
  status: z.enum(['UPLOADING', 'PROCESSING', 'READY', 'FAILED']),
  createdBy: userSummarySchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  myRole: contentRoleSchema.describe(
    'Quyền thực tế: VIEWER (share chỉ xem), EDITOR (thành viên: xem, tạo, sửa), OWNER (người tạo/được share chỉnh sửa: thêm xoá, chia sẻ)',
  ),
  section: sectionSchema.describe('Khu chứa: DOCS (Tài liệu) hoặc VIDEOS (Video)'),
  isFavorite: z.boolean(),
  tags: z.array(tagSchema),
  childCount: z.number().int().nullable().describe('Số mục con (chỉ với FOLDER)'),
  size: z.number().int().nullable().describe('Kích thước phiên bản hiện tại (FILE/VIDEO)'),
  mime: z.string().nullable(),
});

export const listNodesQuery = z.object({
  parentId: z.uuid().optional().describe('Bỏ trống = gốc của khu `section`'),
  section: sectionSchema.default('DOCS').describe('Khu cần liệt kê khi không có parentId'),
  type: nodeTypeSchema.optional(),
  sort: z.enum(['name', 'updatedAt', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createFolderBody = z.object({
  parentId: z.uuid().nullable().optional().describe('Bỏ trống/null = gốc của khu `section`'),
  section: sectionSchema.optional().describe('Khu khi tạo ở gốc; có parentId thì theo thư mục cha'),
  name: nodeNameSchema,
});

export const renameNodeBody = z.object({ name: nodeNameSchema });

export const moveNodeBody = z.object({
  targetParentId: z.uuid().nullable().describe('Folder đích; null = gốc của workspace'),
});

export const breadcrumbSchema = z.array(
  z.object({ id: z.uuid(), name: z.string(), type: nodeTypeSchema }),
);

export const sharedWithMeSchema = z.object({
  node: nodeSchema,
  shareRole: z.enum(['EDITOR', 'VIEWER']),
  sharedBy: userSummarySchema.nullable(),
  sharedAt: z.date(),
  workspace: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
});

export type ListNodesQuery = z.output<typeof listNodesQuery>;
export type CreateFolderBody = z.output<typeof createFolderBody>;
export type NodeDto = z.output<typeof nodeSchema>;

export const activityQuery = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const activitySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      action: z
        .string()
        .describe(
          'node.create · node.rename · node.move · document.edit (kèm wordsAdded/wordsRemoved) · file.upload · share.add …',
        ),
      actor: userSummarySchema.nullable(),
      metadata: z.record(z.string(), z.unknown()),
      createdAt: z.date(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
