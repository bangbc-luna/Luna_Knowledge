import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Recently updated in workspace (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let viewer: LoggedIn;
  let sharee: LoggedIn;
  let guest: LoggedIn;
  let wsId: string;
  let docA: string;
  let docC: string;
  const http = () => request(ctx.app.getHttpServer());

  const updates = (as: LoggedIn, query = '') =>
    http().get(`/api/v1/workspaces/${wsId}/recently-updated?${query}`).set(as.auth);

  const names = (res: request.Response) => res.body.items.map((n: { name: string }) => n.name);

  const folder = async (name: string, section?: 'DOCS' | 'VIDEOS') =>
    (
      await http()
        .post(`/api/v1/workspaces/${wsId}/folders`)
        .set(alice.auth)
        .send({ name, parentId: null, section })
        .expect(201)
    ).body.id as string;

  const document = async (name: string, parentId: string | null) =>
    (
      await http()
        .post(`/api/v1/workspaces/${wsId}/documents`)
        .set(alice.auth)
        .send({ name, parentId })
        .expect(201)
    ).body.node.id as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    viewer = await loginAs(ctx, 'viewer@lunatech.vn');
    sharee = await loginAs(ctx, 'sharee@lunatech.vn');
    guest = await loginAs(ctx, 'guest@lunatech.vn');

    const ws = await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .send({ name: 'Updates', slug: 'updates', memberEmails: ['bob@lunatech.vn'] })
      .expect(201);
    wsId = ws.body.id;
    await http()
      .post(`/api/v1/workspaces/${wsId}/members`)
      .set(alice.auth)
      .send({ email: 'viewer@lunatech.vn' })
      .expect(201);
    await ctx.prisma.workspaceMember.updateMany({
      where: { workspaceId: wsId, userId: viewer.userId },
      data: { role: 'VIEWER' },
    });

    const shared = await folder('Chung');
    const own = await folder('Riêng');
    await folder('Phim', 'VIDEOS');
    docA = await document('A', shared);
    await document('B', own);
    docC = await document('C', null);
    await http()
      .post(`/api/v1/nodes/${shared}/shares`)
      .set(alice.auth)
      .send({ email: 'sharee@lunatech.vn', role: 'VIEWER' })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('mới nhất trước, không có folder; đổi tên đẩy mục lên đầu', async () => {
    await http().patch(`/api/v1/nodes/${docA}`).set(alice.auth).send({ name: 'A2' }).expect(200);
    const res = await updates(bob).expect(200);
    expect(names(res)).toEqual(['A2', 'C', 'B']);
    expect(res.body.items.every((n: { type: string }) => n.type !== 'FOLDER')).toBe(true);
    expect(res.body.nextCursor).toBeNull();
  });

  it('phân trang cursor không trùng không sót; cursor sai → 400', async () => {
    const p1 = await updates(bob, 'limit=2').expect(200);
    expect(names(p1)).toEqual(['A2', 'C']);
    const p2 = await updates(bob, `limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(names(p2)).toEqual(['B']);
    expect(p2.body.nextCursor).toBeNull();
    await updates(bob, 'cursor=xxx').expect(400);
    await updates(bob, 'limit=51').expect(400);
  });

  it('VIEWER của workspace thấy mọi mục với myRole VIEWER', async () => {
    const res = await updates(viewer).expect(200);
    expect(names(res)).toEqual(['A2', 'C', 'B']);
    expect(res.body.items.map((n: { myRole: string }) => n.myRole)).toEqual([
      'VIEWER',
      'VIEWER',
      'VIEWER',
    ]);
  });

  it('người chỉ được share chỉ thấy mục trong folder được share', async () => {
    expect(names(await updates(sharee).expect(200))).toEqual(['A2']);
  });

  it('người ngoài, workspace không tồn tại → 404', async () => {
    await updates(guest).expect(404);
    await http()
      .get(`/api/v1/workspaces/${randomUUID()}/recently-updated`)
      .set(bob.auth)
      .expect(404);
  });

  it('mục trong thùng rác không xuất hiện; section VIDEOS không lẫn tài liệu', async () => {
    await http().delete(`/api/v1/nodes/${docC}`).set(alice.auth).expect(204);
    expect(names(await updates(bob).expect(200))).toEqual(['A2', 'B']);
    expect(names(await updates(bob, 'section=VIDEOS').expect(200))).toEqual([]);
  });
});
