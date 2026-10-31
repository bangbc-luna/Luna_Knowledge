import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations', import.meta.url),
);

const WAVE2: string[] = [
  '20261031123247_tree_guard',
  '20261031125329_indexes',
  '20261031140000_foreign_keys',
  '20261031150000_constraints',
];

describe('Wave 2 migrations upgrade existing data (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;

  let userId: string;
  let wsId: string;
  let trashedFolder: string;
  let liveChild: string;
  let docNode: string;
  let videoNodeId: string;
  let nullPathNode: string;
  let blobNegative: string;
  let rootlessA: string;
  let rootlessB: string;
  let rootlessLive: string;
  let resolvedThread: string;
  let openThread: string;
  let nullMentions: string;

  const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await client.query<T>(sql, params)).rows[0]!;

  const insertNode = async (name: string, parentId: string | null, type = 'FOLDER') =>
    (
      await one<{ id: string }>(
        `INSERT INTO nodes (id, workspace_id, parent_id, type, name, name_normalized, created_by, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $4, $5, now()) RETURNING id`,
        [wsId, parentId, type, name, userId],
      )
    ).id;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    const entries = await readdir(MIGRATIONS, { withFileTypes: true });
    const before = entries
      .filter((e) => e.isDirectory() && !WAVE2.includes(e.name))
      .map((e) => e.name)
      .sort();
    for (const name of before)
      await client.query(await readFile(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));

    userId = (
      await one<{ id: string }>(
        `INSERT INTO users (id, email, name, updated_at)
         VALUES (gen_random_uuid(), 'upgrade@lunatech.vn', 'Upgrade', now()) RETURNING id`,
      )
    ).id;
    wsId = (
      await one<{ id: string }>(
        `INSERT INTO workspaces (id, name, slug, created_by, updated_at)
         VALUES (gen_random_uuid(), 'Upgrade', 'upgrade', $1, now()) RETURNING id`,
        [userId],
      )
    ).id;

    trashedFolder = await insertNode('F', null);
    liveChild = await insertNode('C', trashedFolder);
    await client.query(
      'UPDATE nodes SET deleted_at = now(), deleted_by = $2, deleted_root_id = $1 WHERE id = $1',
      [trashedFolder, userId],
    );
    await client.query(
      `INSERT INTO audit_logs (action, target_id, workspace_id, actor_id) VALUES ('node.move', 'x', $1, $2)`,
      [wsId, userId],
    );
    await client.query(
      `INSERT INTO notifications (id, user_id, type, payload) VALUES (gen_random_uuid(), $1, 'mention', '{}')`,
      [userId],
    );

    const videoNode = await insertNode('V', null, 'VIDEO');
    const orphan = randomUUID();
    await client.query(
      `INSERT INTO videos (node_id, version_id, duration_sec, width, height, renditions, hls_blob_id, poster_blob_id, sprite_blob_id, key_encrypted)
       VALUES ($1, $2, 1, -4, 1, '[]', $3, $4, $5, '\\x01')`,
      [videoNode, orphan, randomUUID(), randomUUID(), randomUUID()],
    );
    docNode = await insertNode('D', null, 'DOCUMENT');
    await client.query(`INSERT INTO documents (node_id, last_edited_by) VALUES ($1, $2)`, [
      docNode,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO document_versions (id, node_id, version_no, restored_from_id, yjs_snapshot, content_json, content_text)
       VALUES (gen_random_uuid(), $1, 1, $2, '\\x01', '{}', '')`,
      [docNode, randomUUID()],
    );
    videoNodeId = videoNode;

    nullPathNode = await insertNode('NP', null);
    await client.query('UPDATE nodes SET path = NULL WHERE id = $1', [nullPathNode]);

    rootlessA = await insertNode('RA', null);
    rootlessB = await insertNode('RB', rootlessA);
    rootlessLive = await insertNode('RL', rootlessA);
    await client.query('UPDATE nodes SET deleted_at = now(), deleted_by = $2 WHERE id = ANY($1)', [
      [rootlessA, rootlessB],
      userId,
    ]);

    const threadNode = await insertNode('T', null, 'DOCUMENT');
    resolvedThread = (
      await one<{ id: string }>(
        `INSERT INTO comment_threads (id, node_id, quoted_text, status, created_by, resolved_at)
         VALUES (gen_random_uuid(), $1, 'q', 'RESOLVED', $2, NULL) RETURNING id`,
        [threadNode, userId],
      )
    ).id;
    openThread = (
      await one<{ id: string }>(
        `INSERT INTO comment_threads (id, node_id, quoted_text, status, created_by, resolved_at, resolved_by)
         VALUES (gen_random_uuid(), $1, 'q', 'OPEN', $2, now(), $2) RETURNING id`,
        [threadNode, userId],
      )
    ).id;
    nullMentions = (
      await one<{ id: string }>(
        `INSERT INTO comments (id, thread_id, author_id, body, mentions)
         VALUES (gen_random_uuid(), $1, $2, 'b', NULL) RETURNING id`,
        [openThread, userId],
      )
    ).id;
    await client.query(
      `INSERT INTO video_watch_progress (user_id, node_id, position_sec, updated_at)
       VALUES ($1, $2, -3, now())`,
      [userId, videoNode],
    );
    await client.query(`UPDATE documents SET word_count = -5 WHERE node_id = $1`, [docNode]);
    blobNegative = (
      await one<{ id: string }>(
        `INSERT INTO blobs (id, node_id, kind, provider, container, key, size_bytes, mime)
         VALUES (gen_random_uuid(), $1, 'ORIGINAL', 'S3', 'bucket', 'neg', -7, 'text/plain') RETURNING id`,
        [docNode],
      )
    ).id;
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('các migration đợt 2 chạy được trên dữ liệu cũ', async () => {
    for (const name of WAVE2)
      await client.query(await readFile(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
  });

  it('index mới thay index cũ và dữ liệu cũ còn nguyên', async () => {
    const names = (
      await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE indexname = ANY($1)`,
        [
          [
            'audit_logs_workspace_id_created_at_idx',
            'notifications_user_id_read_at_created_at_idx',
            'nodes_workspace_id_deleted_root_id_idx',
            'audit_logs_target_id_id_idx',
            'notifications_unread_idx',
            'nodes_deleted_root_id_idx',
          ],
        ],
      )
    ).rows
      .map((r) => r.indexname)
      .sort();
    expect(names).toEqual([
      'audit_logs_target_id_id_idx',
      'nodes_deleted_root_id_idx',
      'notifications_unread_idx',
    ]);
    const counts = await one<{ audit: number; notifications: number }>(
      `SELECT (SELECT count(*)::int FROM audit_logs) AS audit,
              (SELECT count(*)::int FROM notifications) AS notifications`,
    );
    expect(counts).toEqual({ audit: 1, notifications: 1 });
  });

  it('mục còn sống dưới folder đã xoá được đưa vào thùng rác cùng folder đó', async () => {
    const c = await one<{
      deleted_at: Date | null;
      deleted_by: string | null;
      deleted_root_id: string | null;
    }>('SELECT deleted_at, deleted_by, deleted_root_id FROM nodes WHERE id = $1', [liveChild]);
    expect(c.deleted_root_id).toBe(trashedFolder);
    expect(c.deleted_by).toBe(userId);
    expect(c.deleted_at).not.toBeNull();
  });

  it('tham chiếu mồ côi ở cột nullable về NULL, khoá ngoại bắt buộc để NOT VALID', async () => {
    const v = await one<{ poster: string | null; sprite: string | null }>(
      'SELECT poster_blob_id AS poster, sprite_blob_id AS sprite FROM videos WHERE node_id = $1',
      [videoNodeId],
    );
    expect(v).toEqual({ poster: null, sprite: null });
    const d = await one<{ last_edited_by: string | null }>(
      'SELECT last_edited_by FROM documents WHERE node_id = $1',
      [docNode],
    );
    expect(d.last_edited_by).toBeNull();
    const dv = await one<{ restored_from_id: string | null }>(
      'SELECT restored_from_id FROM document_versions WHERE node_id = $1',
      [docNode],
    );
    expect(dv.restored_from_id).toBeNull();
    const c = await client.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE conname IN ('videos_hls_blob_id_fkey', 'videos_version_id_fkey')
        ORDER BY conname`,
    );
    expect(c.rows).toEqual([
      { conname: 'videos_hls_blob_id_fkey', convalidated: false },
      { conname: 'videos_version_id_fkey', convalidated: false },
    ]);
  });

  it('ràng buộc nhỏ sửa dữ liệu bẩn trước khi áp dụng', async () => {
    const p = await one<{ path: string | null }>('SELECT path::text FROM nodes WHERE id = $1', [
      nullPathNode,
    ]);
    expect(p.path).toBe(nullPathNode.replaceAll('-', ''));

    const m = await one<{ mentions: string[] }>('SELECT mentions FROM comments WHERE id = $1', [
      nullMentions,
    ]);
    expect(m.mentions).toEqual([]);

    const r = await one<{ resolved_at: Date | null; created_at: Date }>(
      'SELECT resolved_at, created_at FROM comment_threads WHERE id = $1',
      [resolvedThread],
    );
    expect(r.resolved_at).toEqual(r.created_at);
    const o = await one<{ resolved_at: Date | null; resolved_by: string | null }>(
      'SELECT resolved_at, resolved_by FROM comment_threads WHERE id = $1',
      [openThread],
    );
    expect(o).toEqual({ resolved_at: null, resolved_by: null });

    const w = await one<{ position_sec: number }>(
      'SELECT position_sec FROM video_watch_progress WHERE node_id = $1',
      [videoNodeId],
    );
    expect(w.position_sec).toBe(0);
    const d = await one<{ word_count: number }>(
      'SELECT word_count FROM documents WHERE node_id = $1',
      [docNode],
    );
    expect(d.word_count).toBe(0);
    const v = await one<{ width: number; version_id: string }>(
      'SELECT width, version_id FROM videos WHERE node_id = $1',
      [videoNodeId],
    );
    expect(v.width).toBe(0);
    const fk = await one<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint WHERE conname = 'videos_version_id_fkey'`,
    );
    expect(fk.convalidated).toBe(false);
    const b = await one<{ size_bytes: string }>('SELECT size_bytes FROM blobs WHERE id = $1', [
      blobNegative,
    ]);
    expect(b.size_bytes).toBe('0');
  });

  it('mục trong thùng rác mất deleted_root_id được gán về gốc thùng rác gần nhất', async () => {
    const rows = await client.query<{ id: string; deleted_root_id: string | null }>(
      'SELECT id, deleted_root_id FROM nodes WHERE id = ANY($1)',
      [[rootlessA, rootlessB, rootlessLive]],
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.deleted_root_id]));
    expect(byId[rootlessA]).toBe(rootlessA);
    expect(byId[rootlessB]).toBe(rootlessA);
    expect(byId[rootlessLive]).toBe(rootlessA);
  });
});
