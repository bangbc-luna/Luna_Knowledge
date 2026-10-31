import type { PrismaClient } from './generated/prisma/client.js';

export const TREE_LOCK_NAMESPACE = 7101;

export async function lockWorkspaceTree(
  tx: Pick<PrismaClient, '$executeRaw'>,
  workspaceId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TREE_LOCK_NAMESPACE}::int, hashtext(${workspaceId}))`;
}
