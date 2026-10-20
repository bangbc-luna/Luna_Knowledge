import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Users & admin (e2e)', () => {
  let ctx: TestContext;
  let admin: LoggedIn;
  let alice: LoggedIn;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    admin = await loginAsAdmin(ctx);
    alice = await loginAs(ctx, 'alice.nguyen@lunatech.vn', { name: 'Alice Nguyễn' });
    await loginAs(ctx, 'bob.tran@lunatech.vn', { name: 'Bob Trần' });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('/me trả workspace kèm vai trò', async () => {
    await http()
      .post('/api/v1/workspaces')
      .set(admin.auth)
      .send({ name: 'Eng', slug: 'eng', ownerEmail: 'alice.nguyen@lunatech.vn' })
      .expect(201);
    const res = await http().get('/api/v1/me').set(alice.auth).expect(200);
    expect(res.body).toMatchObject({
      email: 'alice.nguyen@lunatech.vn',
      name: 'Alice Nguyễn',
      workspaces: [{ slug: 'eng', role: 'OWNER' }],
    });
  });

  it('/users?q= tìm theo tên hoặc email, không phân biệt hoa thường', async () => {
    const byName = await http().get('/api/v1/users?q=bob').set(alice.auth).expect(200);
    expect(byName.body.map((u: { email: string }) => u.email)).toEqual(['bob.tran@lunatech.vn']);
    const byEmail = await http().get('/api/v1/users?q=ALICE.N').set(alice.auth).expect(200);
    expect(byEmail.body).toHaveLength(1);
    await http().get('/api/v1/users?q=').set(alice.auth).expect(400);
  });

  it('API admin chỉ dành cho System Admin', async () => {
    await http().get('/api/v1/admin/users').set(alice.auth).expect(403);
    const res = await http().get('/api/v1/admin/users?limit=2').set(admin.auth).expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).toBeTruthy();
    const next = await http()
      .get(`/api/v1/admin/users?limit=2&cursor=${res.body.nextCursor}`)
      .set(admin.auth)
      .expect(200);
    expect(next.body.items).toHaveLength(1);
    expect(next.body.nextCursor).toBeNull();
  });

  it('khóa user thu hồi ngay mọi phiên; user bị khóa biến mất khỏi tìm kiếm', async () => {
    const bob = await loginAs(ctx, 'bob.tran@lunatech.vn');
    const res = await http()
      .patch(`/api/v1/admin/users/${bob.userId}`)
      .set(admin.auth)
      .send({ status: 'DISABLED' })
      .expect(200);
    expect(res.body.status).toBe('DISABLED');

    const me = await http().get('/api/v1/me').set(bob.auth).expect(401);
    expect(me.body.error.code).toBe('SESSION_EXPIRED');
    await bob.agent.post('/api/v1/auth/refresh').expect(401);

    const search = await http().get('/api/v1/users?q=bob').set(alice.auth).expect(200);
    expect(search.body).toEqual([]);
    const disabled = await http()
      .get('/api/v1/admin/users?status=DISABLED')
      .set(admin.auth)
      .expect(200);
    expect(disabled.body.items.map((u: { email: string }) => u.email)).toEqual([
      'bob.tran@lunatech.vn',
    ]);
  });

  it('admin không tự khóa / tự gỡ quyền của chính mình', async () => {
    await http()
      .patch(`/api/v1/admin/users/${admin.userId}`)
      .set(admin.auth)
      .send({ isSystemAdmin: false })
      .expect(403);
  });

  it('cấp quyền System Admin có hiệu lực ngay', async () => {
    await http()
      .patch(`/api/v1/admin/users/${alice.userId}`)
      .set(admin.auth)
      .send({ isSystemAdmin: true })
      .expect(200);
    await http().get('/api/v1/admin/users').set(alice.auth).expect(200);
    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'user.update', targetId: alice.userId },
    });
    expect(log?.actorId).toBe(admin.userId);
  });
});
