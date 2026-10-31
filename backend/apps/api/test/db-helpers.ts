import type { PrismaClient } from '@luna/db';

export async function waitForLockWait(
  prisma: PrismaClient,
  timeoutMs: number,
  minWaiting = 1,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_locks
       WHERE NOT granted
         AND (locktype IN ('advisory', 'transactionid', 'tuple') OR relation = 'nodes'::regclass)`;
    if (row && row.waiting >= minWaiting) return;
    if (Date.now() > deadline) throw new Error(`no lock wait within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function treeInvariants(
  prisma: PrismaClient,
): Promise<{ liveUnderDeleted: number; badPaths: number; cycles: number }> {
  const [row] = await prisma.$queryRaw<
    Array<{ live_under_deleted: number; bad_paths: number; cycles: number }>
  >`
    SELECT
      (SELECT count(*)::int FROM nodes c
        WHERE c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM nodes p
                       WHERE p.deleted_at IS NOT NULL AND p.id <> c.id AND c.path <@ p.path)
      ) AS live_under_deleted,
      (SELECT count(*)::int FROM nodes c LEFT JOIN nodes p ON p.id = c.parent_id
        WHERE c.path IS DISTINCT FROM
              CASE WHEN c.parent_id IS NULL THEN text2ltree(replace(c.id::text, '-', ''))
                   ELSE p.path || text2ltree(replace(c.id::text, '-', '')) END
      ) AS bad_paths,
      (SELECT count(*)::int FROM nodes c JOIN nodes p ON p.id = c.parent_id
        WHERE p.path <@ c.path
      ) AS cycles`;
  return {
    liveUnderDeleted: row?.live_under_deleted ?? 0,
    badPaths: row?.bad_paths ?? 0,
    cycles: row?.cycles ?? 0,
  };
}

export async function indexesUsed(
  prisma: PrismaClient,
  sql: string,
  ...params: unknown[]
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    const rows = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(
      `EXPLAIN (FORMAT JSON) ${sql}`,
      ...params,
    );
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'Index Name' && typeof value === 'string') names.push(value);
          else walk(value);
        }
      }
    };
    walk(rows[0]?.['QUERY PLAN']);
    return names;
  });
}
