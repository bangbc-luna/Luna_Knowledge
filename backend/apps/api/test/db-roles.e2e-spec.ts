import { createPrismaClient, type PrismaClient } from '@luna/db';
import pg from 'pg';
import request from 'supertest';
import { APP_CONFIG, loadAppConfig } from '../src/config/app-config.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Non-owner app database role (e2e)', () => {
  let ctx: TestContext;
  let owner: PrismaClient;
  let app: pg.Client;
  let alice: LoggedIn;
  let wsId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    const appUrl = process.env.DATABASE_APP_URL!;
    owner = createPrismaClient({ connectionString: process.env.DATABASE_URL!, max: 2 });
    await resetDatabase(owner);
    ctx = await createTestApp([
      [APP_CONFIG, loadAppConfig({ ...process.env, DATABASE_URL: appUrl })],
    ]);
    app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    wsId = (
      await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({ name: 'Roles', slug: 'roles' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.end();
    await ctx?.close();
    await owner?.$disconnect();
  });

  it('app role đúng là login luna_app_e2e, không phải owner', async () => {
    const { rows } = await app.query<{ me: string; member: boolean; owns: boolean }>(
      `SELECT current_user AS me,
              pg_has_role(current_user, 'luna_app', 'MEMBER') AS member,
              (SELECT tableowner FROM pg_tables WHERE tablename = 'audit_logs') = current_user AS owns`,
    );
    expect(rows[0]).toEqual({ me: 'luna_app_e2e', member: true, owns: false });
  });

  it('app role ghi và đọc được audit_logs', async () => {
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO audit_logs (action, target_id) VALUES ('roles.test', 'r1') RETURNING id`,
    );
    const read = await app.query('SELECT action FROM audit_logs WHERE id = $1', [rows[0]!.id]);
    expect(read.rows).toEqual([{ action: 'roles.test' }]);
  });

  it.each([
    'UPDATE audit_logs SET action = $$x$$',
    'DELETE FROM audit_logs',
    'TRUNCATE audit_logs',
  ])('app role không chạy được: %s', async (sql) => {
    await expect(app.query(sql)).rejects.toThrow(/permission denied/);
  });

  it('app role không tắt được trigger và không tạo được bảng', async () => {
    await expect(
      app.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only'),
    ).rejects.toThrow(/must be owner/);
    await expect(app.query('CREATE TABLE e2e_app_made ()')).rejects.toThrow(/permission denied/);
  });

  it('app role không đọc được _prisma_migrations', async () => {
    await expect(app.query('SELECT 1 FROM _prisma_migrations')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('owner TRUNCATE audit_logs cũng bị trigger chặn', async () => {
    await expect(owner.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
  });

  it('purge_audit_logs gọi từ app role chỉ xoá bản ghi quá 1 năm', async () => {
    await owner.$executeRawUnsafe(`
      INSERT INTO audit_logs (action, target_id, created_at) VALUES
        ('roles.purge', 'old1', now() - interval '400 days'),
        ('roles.purge', 'old2', now() - interval '400 days'),
        ('roles.purge', 'young', now() - interval '300 days')`);
    const { rows } = await app.query<{ n: number }>('SELECT purge_audit_logs(1000) AS n');
    expect(rows[0]!.n).toBe(2);
    const left = await owner.$queryRawUnsafe<{ target_id: string }[]>(
      `SELECT target_id FROM audit_logs WHERE action = 'roles.purge'`,
    );
    expect(left).toEqual([{ target_id: 'young' }]);
  });

  it('purge_audit_logs chạy với search_path cố định', async () => {
    const rows = await owner.$queryRawUnsafe<{ secdef: boolean; config: string[] }[]>(
      `SELECT prosecdef AS secdef, proconfig AS config FROM pg_proc WHERE proname = 'purge_audit_logs'`,
    );
    expect(rows).toEqual([{ secdef: true, config: ['search_path=public, pg_temp'] }]);
  });

  it('app role chạy được luồng cây: tạo folder, tạo con, di chuyển, xoá mềm', async () => {
    const folder = async (name: string, parentId: string | null) =>
      (
        await http()
          .post(`/api/v1/workspaces/${wsId}/folders`)
          .set(alice.auth)
          .send({ name, parentId })
          .expect(201)
      ).body.id as string;
    const a = await folder('A', null);
    const b = await folder('B', null);
    const child = await folder('Con', a);
    await http()
      .post(`/api/v1/nodes/${child}/move`)
      .set(alice.auth)
      .send({ targetParentId: b })
      .expect(200);
    await http().delete(`/api/v1/nodes/${b}`).set(alice.auth).expect(204);
    const rows = await owner.$queryRawUnsafe<{ id: string; deleted: boolean; parent: string }[]>(
      `SELECT id::text, deleted_at IS NOT NULL AS deleted, parent_id::text AS parent
         FROM nodes WHERE id = ANY($1::uuid[]) ORDER BY name`,
      [a, b, child],
    );
    expect(rows).toEqual([
      { id: a, deleted: false, parent: null },
      { id: b, deleted: true, parent: null },
      { id: child, deleted: true, parent: b },
    ]);
  });

  it('bảng do migration tạo sau này tự có quyền cho app role', async () => {
    await owner.$executeRawUnsafe(
      'CREATE TABLE e2e_default_priv (id serial PRIMARY KEY, note text)',
    );
    try {
      const { rows } = await app.query<{ id: number }>(
        `INSERT INTO e2e_default_priv (note) VALUES ('ok') RETURNING id`,
      );
      expect(rows[0]!.id).toBe(1);
    } finally {
      await owner.$executeRawUnsafe('DROP TABLE e2e_default_priv');
    }
  });
});
