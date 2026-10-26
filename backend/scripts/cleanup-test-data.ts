import { createPrismaClient, Prisma } from '@luna/db';
import {
  createSearchClient,
  databaseEnvSchema,
  loadEnv,
  SEARCH_INDEX,
  searchEnvSchema,
} from '@luna/shared';
import { z } from 'zod';

const env = loadEnv(databaseEnvSchema.extend({ NODE_ENV: z.string().optional() }));
if (env.NODE_ENV !== 'development') {
  console.error(
    `cleanup-test-data only runs with NODE_ENV=development (got ${env.NODE_ENV ?? 'nothing'})`,
  );
  process.exit(1);
}

const prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 1 });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

try {
  const userIds = ids(
    await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM users WHERE email LIKE 'qa.%@lunatech.vn' OR email LIKE 'load.%@lunatech.vn'`),
  );
  const workspaceIds = ids(
    await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM workspaces WHERE kind = 'TEAM' AND created_by = ANY(${userIds}::uuid[])`),
  );
  const nodeIds = ids(
    await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM nodes
       WHERE workspace_id = ANY(${workspaceIds}::uuid[]) OR created_by = ANY(${userIds}::uuid[])`),
  );

  const [blockers] = await prisma.$queryRaw<
    { content: bigint; versions: bigint; assets: bigint }[]
  >(Prisma.sql`
    SELECT
      (SELECT count(*) FROM nodes c JOIN nodes t ON c.path <@ t.path
        WHERE t.id = ANY(${nodeIds}::uuid[])
          AND NOT c.created_by = ANY(${userIds}::uuid[])
          AND NOT c.workspace_id = ANY(${workspaceIds}::uuid[])) AS content,
      (SELECT count(*) FROM file_versions v
        WHERE v.uploaded_by = ANY(${userIds}::uuid[]) AND NOT v.node_id = ANY(${nodeIds}::uuid[])) AS versions,
      (SELECT count(*) FROM document_assets a
        WHERE a.created_by = ANY(${userIds}::uuid[]) AND NOT a.node_id = ANY(${nodeIds}::uuid[])) AS assets`);
  if (blockers && (blockers.content || blockers.versions || blockers.assets)) {
    console.error(
      'Stopped: test accounts are mixed with real content ' +
        `(${blockers.content} real items under test folders, ${blockers.versions} file versions ` +
        `and ${blockers.assets} embedded files uploaded by test accounts on real items). ` +
        'Remove them by hand, then run again.',
    );
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM nodes WHERE id = ANY(${nodeIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM workspaces WHERE id = ANY(${workspaceIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM comment_threads WHERE created_by = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM comments WHERE author_id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM upload_sessions WHERE created_by = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`;
    await tx.$executeRaw`
      DELETE FROM audit_logs
       WHERE actor_id = ANY(${userIds}::uuid[])
          OR workspace_id = ANY(${workspaceIds}::uuid[])
          OR (target_type = 'user' AND target_id = ANY(${userIds}::text[]))
          OR (target_type = 'node' AND target_id = ANY(${nodeIds}::text[]))`;
    await tx.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`;
  });

  const search = searchEnvSchema.safeParse(process.env);
  if (search.success && nodeIds.length) {
    await createSearchClient(search.data.MEILI_URL, search.data.MEILI_MASTER_KEY)
      .index(SEARCH_INDEX)
      .deleteDocuments(nodeIds)
      .catch((err: unknown) =>
        console.warn(`Search index not cleaned (${String(err)}); the nightly reindex will fix it`),
      );
  }
  console.log(
    `✔ Removed ${userIds.length} test users, ${workspaceIds.length} workspaces, ${nodeIds.length} items`,
  );
} finally {
  await prisma.$disconnect();
}
