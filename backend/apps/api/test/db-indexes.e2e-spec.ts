import { randomUUID } from 'node:crypto';
import { createTestApp, resetDatabase, type TestContext } from './create-test-app.js';
import { indexesUsed } from './db-helpers.js';

const uuid = randomUUID();
const from = new Date('2026-01-01T00:00:00Z');
const to = new Date('2026-02-01T00:00:00Z');

const OLD_INDEXES = [
  'audit_logs_workspace_id_created_at_idx',
  'audit_logs_actor_id_created_at_idx',
  'audit_logs_action_created_at_idx',
  'notifications_user_id_read_at_created_at_idx',
  'nodes_workspace_id_deleted_root_id_idx',
];

describe('Database indexes (e2e)', () => {
  let ctx: TestContext;

  const fkColumnsWithoutLeadingIndex = async (): Promise<string[]> => {
    const rows = await ctx.prisma.$queryRaw<Array<{ fk: string }>>`
      SELECT c.conrelid::regclass::text || '.' || a.attname AS fk
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND NOT EXISTS (
           SELECT 1 FROM pg_index i
            WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`;
    return rows.map((r) => r.fk);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.prisma.$executeRaw`
      INSERT INTO audit_logs (action, target_id, created_at)
      SELECT CASE WHEN g % 10 = 0 THEN 'node.view' ELSE 'node.move' END, 'target-' || (g % 2000), now() - (g || ' seconds')::interval
        FROM generate_series(1, 5000) g`;
    const user = await ctx.prisma.user.create({ data: { email: 'idx@lunatech.vn', name: 'Idx' } });
    const ws = await ctx.prisma.workspace.create({
      data: { name: 'Idx', slug: 'idx', createdById: user.id },
    });
    await ctx.prisma.$executeRaw`
      INSERT INTO notifications (id, user_id, type, payload, read_at)
      SELECT gen_random_uuid(), ${user.id}::uuid, 'mention', '{}', CASE WHEN g % 50 = 0 THEN NULL ELSE now() END
        FROM generate_series(1, 3000) g`;
    await ctx.prisma.$executeRaw`
      INSERT INTO nodes (id, workspace_id, type, name, name_normalized, created_by, updated_at, deleted_at, deleted_root_id)
      SELECT s.id, ${ws.id}::uuid, 'DOCUMENT', 'n' || s.g, 'n' || s.g, ${user.id}::uuid, now(),
             CASE WHEN s.g % 100 = 0 THEN now() END, CASE WHEN s.g % 100 = 0 THEN s.id END
        FROM (SELECT g, gen_random_uuid() AS id FROM generate_series(1, 3000) g) s`;
    for (const table of ['audit_logs', 'notifications', 'nodes'])
      await ctx.prisma.$executeRawUnsafe(`ANALYZE ${table}`);
  });

  afterAll(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.close();
  });

  it.each([
    [
      'SELECT * FROM audit_logs WHERE target_id = $1 AND action = ANY($2) ORDER BY id DESC LIMIT 21',
      ['x', ['node.move']],
      'audit_logs_target_id_id_idx',
    ],
    [
      'SELECT * FROM audit_logs WHERE workspace_id = $1::uuid ORDER BY id DESC LIMIT 51',
      [uuid],
      'audit_logs_workspace_id_id_idx',
    ],
    [
      'SELECT * FROM audit_logs WHERE actor_id = $1::uuid ORDER BY id DESC LIMIT 51',
      [uuid],
      'audit_logs_actor_id_id_idx',
    ],
    [
      'SELECT * FROM audit_logs WHERE action = $1 ORDER BY id DESC LIMIT 51',
      ['node.view'],
      'audit_logs_action_id_idx',
    ],
    [
      'SELECT * FROM audit_logs WHERE created_at >= $1 AND created_at < $2',
      [from, to],
      'audit_logs_created_at_idx',
    ],
    [
      'SELECT * FROM notifications WHERE user_id = $1::uuid ORDER BY id DESC LIMIT 21',
      [uuid],
      'notifications_user_id_id_idx',
    ],
    [
      'SELECT count(*) FROM notifications WHERE user_id = $1::uuid AND read_at IS NULL',
      [uuid],
      'notifications_unread_idx',
    ],
    ['SELECT id FROM nodes WHERE deleted_root_id = $1::uuid', [uuid], 'nodes_deleted_root_id_idx'],
    ['SELECT id FROM nodes WHERE workspace_id = $1::uuid', [uuid], 'nodes_workspace_id_idx'],
  ])('truy vấn %s dùng index %s', async (sql, params, index) => {
    expect(await indexesUsed(ctx.prisma, sql, ...(params as unknown[]))).toContain(index);
  });

  it('mọi khoá ngoại trong danh sách 2.3 có index bắt đầu bằng cột đó', async () => {
    const required = [
      'favorites.node_id',
      'recent_views.node_id',
      'video_watch_progress.node_id',
      'upload_sessions.node_id',
      'file_versions.original_blob_id',
      'file_versions.preview_blob_id',
      'file_versions.thumbnail_blob_id',
    ];
    const missing = (await fkColumnsWithoutLeadingIndex()).filter((fk) => required.includes(fk));
    expect(missing).toEqual([]);
  });

  it('index cũ đã bỏ', async () => {
    const rows = await ctx.prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE indexname = ANY(${OLD_INDEXES})`;
    expect(rows).toEqual([]);
  });
});
