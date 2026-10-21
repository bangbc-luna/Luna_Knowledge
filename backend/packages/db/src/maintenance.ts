import type { PrismaClient } from './generated/prisma/client.js';

export const TRASH_RETENTION_DAYS = 30;

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
