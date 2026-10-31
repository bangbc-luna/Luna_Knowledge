import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations', import.meta.url),
);

const WAVE2: string[] = ['20261031123247_tree_guard'];

describe('Wave 2 migrations upgrade existing data (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;

  let userId: string;
  let wsId: string;
  let trashedFolder: string;
  let liveChild: string;

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
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('các migration đợt 2 chạy được trên dữ liệu cũ', async () => {
    for (const name of WAVE2)
      await client.query(await readFile(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
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
});
