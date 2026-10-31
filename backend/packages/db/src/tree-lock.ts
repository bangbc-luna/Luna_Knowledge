import type { PrismaClient } from './generated/prisma/client.js';

export const TREE_LOCK_NAMESPACE = 7101;

export async function lockWorkspaceTree(
  tx: Pick<PrismaClient, '$executeRaw'>,
  workspaceId: string,
  { lockTimeoutMs }: { lockTimeoutMs?: number } = {},
): Promise<void> {
  if (lockTimeoutMs !== undefined) {
    await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)`;
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TREE_LOCK_NAMESPACE}::int, hashtext(${workspaceId}))`;
}
