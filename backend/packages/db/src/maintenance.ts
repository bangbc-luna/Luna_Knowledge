import type { PrismaClient } from './generated/prisma/client.js';
import { lockWorkspaceTree } from './tree-lock.js';

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

export const AUDIT_PURGE_BATCH = 5000;
export const READ_NOTIFICATION_RETENTION_DAYS = 90;
export const RECENT_VIEWS_PER_USER = 50;
const RETENTION_BATCH = 5000;
const WORKSPACE_PURGE_LOCK_TIMEOUT_MS = 10_000;
const WORKSPACE_PURGE_STATEMENT_TIMEOUT_MS = 10 * 60_000;

export interface RetentionOptions {
  workspacePurgeDays: number;
  autoVersionThinDays: number;
  now?: Date;
}

export interface RetentionResult {
  auditLogs: number;
  notifications: number;
  recentViews: number;
  documentVersions: number;
  workspaces: number;
}

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

async function inBatches(batchSize: number, step: (limit: number) => Promise<number>) {
  const limit = Math.max(1, Math.floor(batchSize));
  let total = 0;
  for (;;) {
    const removed = await step(limit);
    total += removed;
    if (removed < limit) return total;
  }
}

export async function purgeOldAuditLogs(
  prisma: PrismaClient,
  { batchSize = AUDIT_PURGE_BATCH }: { batchSize?: number } = {},
): Promise<number> {
  let total = 0;
  for (;;) {
    const [row] = await prisma.$queryRaw<Array<{ removed: number }>>`
      SELECT purge_audit_logs(${batchSize}::int) AS removed`;
    const removed = row?.removed ?? 0;
    if (removed <= 0) return total;
    total += removed;
  }
}

export async function purgeReadNotifications(
  prisma: PrismaClient,
  {
    olderThanDays = READ_NOTIFICATION_RETENTION_DAYS,
    now = new Date(),
    batchSize = RETENTION_BATCH,
  }: { olderThanDays?: number; now?: Date; batchSize?: number } = {},
): Promise<number> {
  const cutoff = daysBefore(now, olderThanDays);
  return inBatches(
    batchSize,
    (limit) => prisma.$executeRaw`
      DELETE FROM notifications
       WHERE id IN (SELECT id FROM notifications
                     WHERE read_at IS NOT NULL AND read_at < ${cutoff}
                     ORDER BY id LIMIT ${limit})
         AND read_at IS NOT NULL AND read_at < ${cutoff}`,
  );
}

export async function capRecentViews(
  prisma: PrismaClient,
  {
    keep = RECENT_VIEWS_PER_USER,
    batchSize = RETENTION_BATCH,
  }: { keep?: number; batchSize?: number } = {},
): Promise<number> {
  const kept = Math.max(1, Math.floor(keep));
  return inBatches(
    batchSize,
    (limit) => prisma.$executeRaw`
      DELETE FROM recent_views v
       USING (SELECT user_id, node_id, viewed_at
                FROM (SELECT user_id, node_id, viewed_at, row_number() OVER (
                        PARTITION BY user_id ORDER BY viewed_at DESC, node_id DESC) AS rn
                        FROM recent_views) ranked
               WHERE rn > ${kept}
               LIMIT ${limit}) r
       WHERE v.user_id = r.user_id AND v.node_id = r.node_id AND v.viewed_at = r.viewed_at`,
  );
}

export async function thinAutoVersions(
  prisma: PrismaClient,
  {
    olderThanDays,
    now = new Date(),
    batchSize = RETENTION_BATCH,
  }: { olderThanDays: number; now?: Date; batchSize?: number },
): Promise<number> {
  const cutoff = daysBefore(now, olderThanDays);
  return inBatches(
    batchSize,
    (limit) => prisma.$executeRaw`
      DELETE FROM document_versions v
       USING (SELECT id
                FROM (SELECT id, row_number() OVER (
                        PARTITION BY node_id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                        ORDER BY created_at DESC, id DESC) AS rn
                        FROM document_versions
                       WHERE is_auto AND created_at < ${cutoff}) ranked
               WHERE rn > 1
               LIMIT ${limit}) r
       WHERE v.id = r.id AND v.is_auto AND v.created_at < ${cutoff}`,
  );
}

export async function purgeDeletedWorkspaces(
  prisma: PrismaClient,
  { olderThanDays, now = new Date() }: { olderThanDays: number; now?: Date },
): Promise<number> {
  const cutoff = daysBefore(now, olderThanDays);
  const candidates = await prisma.workspace.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    select: { id: true },
    orderBy: { deletedAt: 'asc' },
  });
  let purged = 0;
  for (const { id } of candidates) {
    purged += await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${`${WORKSPACE_PURGE_STATEMENT_TIMEOUT_MS}ms`}, true)`;
        await lockWorkspaceTree(tx, id, { lockTimeoutMs: WORKSPACE_PURGE_LOCK_TIMEOUT_MS });
        return tx.$executeRaw`
          DELETE FROM workspaces
           WHERE id = ${id}::uuid AND deleted_at IS NOT NULL AND deleted_at < ${cutoff}`;
      },
      {
        maxWait: WORKSPACE_PURGE_LOCK_TIMEOUT_MS,
        timeout: WORKSPACE_PURGE_STATEMENT_TIMEOUT_MS + 60_000,
      },
    );
  }
  return purged;
}

export async function runRetention(
  prisma: PrismaClient,
  { workspacePurgeDays, autoVersionThinDays, now = new Date() }: RetentionOptions,
): Promise<RetentionResult> {
  const auditLogs = await purgeOldAuditLogs(prisma);
  const notifications = await purgeReadNotifications(prisma, { now });
  const recentViews = await capRecentViews(prisma);
  const documentVersions = await thinAutoVersions(prisma, {
    olderThanDays: autoVersionThinDays,
    now,
  });
  const workspaces = await purgeDeletedWorkspaces(prisma, {
    olderThanDays: workspacePurgeDays,
    now,
  });
  return { auditLogs, notifications, recentViews, documentVersions, workspaces };
}
