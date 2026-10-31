import type { PrismaClient } from './generated/prisma/client.js';
import { lockWorkspaceTree } from './tree-lock.js';

export const TRASH_RETENTION_DAYS = 30;

export const AUDIT_PURGE_BATCH = 5000;
export const READ_NOTIFICATION_RETENTION_DAYS = 90;
export const RECENT_VIEWS_PER_USER = 50;
const RETENTION_BATCH = 5000;
const WORKSPACE_PURGE_LOCK_TIMEOUT_MS = 10_000;
const WORKSPACE_PURGE_STATEMENT_TIMEOUT_MS = 10 * 60_000;
const TRASH_PURGE_LOCK_TIMEOUT_MS = 10_000;
const TRASH_PURGE_STATEMENT_TIMEOUT_MS = 10 * 60_000;

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

export type RetentionStep = keyof RetentionResult;

export type RetentionErrorHandler = (
  err: unknown,
  context: { step: RetentionStep; workspaceId?: string },
) => void;

export class WorkspacePurgeError extends AggregateError {
  constructor(
    errors: unknown[],
    readonly purged: number,
    readonly failedWorkspaceIds: string[],
  ) {
    super(errors, `Failed to purge ${failedWorkspaceIds.length} workspace(s)`);
    this.name = 'WorkspacePurgeError';
  }
}

export class TrashPurgeError extends AggregateError {
  constructor(
    errors: unknown[],
    readonly purged: number,
    readonly failedWorkspaceIds: string[],
  ) {
    super(errors, `Failed to purge the trash of ${failedWorkspaceIds.length} workspace(s)`);
    this.name = 'TrashPurgeError';
  }
}

export async function purgeExpiredTrash(
  prisma: PrismaClient,
  {
    olderThanDays = TRASH_RETENTION_DAYS,
    now = new Date(),
    lockTimeoutMs = TRASH_PURGE_LOCK_TIMEOUT_MS,
    onError,
  }: {
    olderThanDays?: number;
    now?: Date;
    lockTimeoutMs?: number;
    onError?: (err: unknown, context: { workspaceId: string }) => void;
  } = {},
): Promise<number> {
  const cutoff = daysBefore(now, olderThanDays);
  const workspaces = await prisma.$queryRaw<Array<{ workspace_id: string }>>`
    SELECT DISTINCT workspace_id FROM nodes
     WHERE deleted_root_id = id AND deleted_at < ${cutoff}`;
  let purged = 0;
  const errors: unknown[] = [];
  const failed: string[] = [];
  for (const { workspace_id: id } of workspaces) {
    try {
      purged += await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${`${TRASH_PURGE_STATEMENT_TIMEOUT_MS}ms`}, true)`;
          await lockWorkspaceTree(tx, id, { lockTimeoutMs });
          return tx.$executeRaw`
            DELETE FROM nodes
             WHERE workspace_id = ${id}::uuid
               AND deleted_root_id = id
               AND deleted_at < ${cutoff}`;
        },
        {
          maxWait: TRASH_PURGE_LOCK_TIMEOUT_MS,
          timeout: TRASH_PURGE_STATEMENT_TIMEOUT_MS + 60_000,
        },
      );
    } catch (err) {
      errors.push(err);
      failed.push(id);
      onError?.(err, { workspaceId: id });
    }
  }
  if (errors.length) throw new TrashPurgeError(errors, purged, failed);
  return purged;
}

export class RetentionError extends AggregateError {
  constructor(
    errors: unknown[],
    readonly result: RetentionResult,
    readonly failedSteps: RetentionStep[],
  ) {
    super(errors, `Retention failed in: ${failedSteps.join(', ')}`);
    this.name = 'RetentionError';
  }
}

export async function purgeDeletedWorkspaces(
  prisma: PrismaClient,
  {
    olderThanDays,
    now = new Date(),
    lockTimeoutMs = WORKSPACE_PURGE_LOCK_TIMEOUT_MS,
    onError,
  }: {
    olderThanDays: number;
    now?: Date;
    lockTimeoutMs?: number;
    onError?: RetentionErrorHandler;
  },
): Promise<number> {
  const cutoff = daysBefore(now, olderThanDays);
  const candidates = await prisma.workspace.findMany({
    where: { deletedAt: { not: null, lt: cutoff }, kind: { not: 'COMPANY' } },
    select: { id: true },
    orderBy: { deletedAt: 'asc' },
  });
  let purged = 0;
  const errors: unknown[] = [];
  const failed: string[] = [];
  for (const { id } of candidates) {
    try {
      purged += await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${`${WORKSPACE_PURGE_STATEMENT_TIMEOUT_MS}ms`}, true)`;
          await lockWorkspaceTree(tx, id, { lockTimeoutMs });
          return tx.$executeRaw`
            DELETE FROM workspaces
             WHERE id = ${id}::uuid
               AND kind <> 'COMPANY'
               AND deleted_at IS NOT NULL
               AND deleted_at < ${cutoff}`;
        },
        {
          maxWait: WORKSPACE_PURGE_LOCK_TIMEOUT_MS,
          timeout: WORKSPACE_PURGE_STATEMENT_TIMEOUT_MS + 60_000,
        },
      );
    } catch (err) {
      errors.push(err);
      failed.push(id);
      onError?.(err, { step: 'workspaces', workspaceId: id });
    }
  }
  if (errors.length) throw new WorkspacePurgeError(errors, purged, failed);
  return purged;
}

export async function runRetention(
  prisma: PrismaClient,
  {
    workspacePurgeDays,
    autoVersionThinDays,
    now = new Date(),
    onError,
  }: RetentionOptions & { onError?: RetentionErrorHandler },
): Promise<RetentionResult> {
  const result: RetentionResult = {
    auditLogs: 0,
    notifications: 0,
    recentViews: 0,
    documentVersions: 0,
    workspaces: 0,
  };
  const errors: unknown[] = [];
  const failedSteps: RetentionStep[] = [];
  const steps: Array<[RetentionStep, () => Promise<number>]> = [
    ['auditLogs', () => purgeOldAuditLogs(prisma)],
    ['notifications', () => purgeReadNotifications(prisma, { now })],
    ['recentViews', () => capRecentViews(prisma)],
    [
      'documentVersions',
      () => thinAutoVersions(prisma, { olderThanDays: autoVersionThinDays, now }),
    ],
    [
      'workspaces',
      () => purgeDeletedWorkspaces(prisma, { olderThanDays: workspacePurgeDays, now, onError }),
    ],
  ];
  for (const [step, run] of steps) {
    try {
      result[step] = await run();
    } catch (err) {
      errors.push(err);
      failedSteps.push(step);
      if (err instanceof WorkspacePurgeError) result[step] = err.purged;
      else onError?.(err, { step });
    }
  }
  if (errors.length) throw new RetentionError(errors, result, failedSteps);
  return result;
}
