import type { PrismaClient } from './generated/prisma/client.js';

export const TRASH_RETENTION_DAYS = 30;

/**
 * Xóa vĩnh viễn các mục nằm trong thùng rác quá hạn (SPEC NODE-6).
 * Chỉ xóa node gốc của mỗi lần xóa; cây con bị xóa theo nhờ FK `parent_id ON DELETE CASCADE`.
 * Trả về số node gốc đã xóa. Object trên MinIO được trigger `blobs_enqueue_gc` đưa vào hàng đợi
 * `blob_gc` và job maintenance xóa sau.
 */
export async function purgeExpiredTrash(
  prisma: PrismaClient,
  { olderThanDays = TRASH_RETENTION_DAYS, now = new Date() } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 3600_000);
  return prisma.$executeRaw`
    DELETE FROM nodes
     WHERE deleted_root_id = id
       AND deleted_at < ${cutoff}`;
}
