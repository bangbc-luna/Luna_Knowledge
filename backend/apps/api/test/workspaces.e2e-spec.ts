import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Workspaces & members (e2e)', () => {
  let ctx: TestContext;
  let admin: LoggedIn;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let carol: LoggedIn;
  let outsider: LoggedIn;
  let wsId: string;
  const http = () => request(ctx.app.getHttpServer());
  const members = async (as: LoggedIn, id = wsId) =>
    (await http().get(`/api/v1/workspaces/${id}/members`).set(as.auth).expect(200)).body.map(
      (m: { user: { email: string }; role: string }) => [m.user.email, m.role],
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    admin = await loginAsAdmin(ctx);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    carol = await loginAs(ctx, 'carol@lunatech.vn', { name: 'Carol' });
    outsider = await loginAs(ctx, 'outsider@lunatech.vn');
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('tạo workspace', () => {
    it('người dùng bất kỳ tạo workspace nhóm và thành quản trị; email của chính mình bị bỏ qua', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({
          name: 'Marketing',
          slug: 'marketing',
          icon: '📣',
          kind: 'COMPANY',
          memberEmails: ['ALICE@lunatech.vn', 'alice@lunatech.vn'],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Marketing',
        slug: 'marketing',
        kind: 'TEAM',
        memberCount: 1,
        myRole: 'ADMIN',
      });
      expect(res.body).not.toHaveProperty('owner');
      wsId = res.body.id;

      const mine = await http().get('/api/v1/workspaces').set(alice.auth).expect(200);
      expect(mine.body).toEqual([expect.objectContaining({ id: wsId, myRole: 'ADMIN' })]);
      const adminMine = await http().get('/api/v1/workspaces').set(admin.auth).expect(200);
      expect(adminMine.body).toEqual([]);
      expect(await members(alice)).toEqual([['alice@lunatech.vn', 'ADMIN']]);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'workspace.create' } })).toBe(1);
    });

    it('memberEmails thành MEMBER; thành viên chưa đăng nhập lần nào được tạo trước theo email', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(bob.auth)
        .send({
          name: 'Sales',
          slug: 'sales',
          memberEmails: ['future.member@lunatech.vn', 'carol@lunatech.vn'],
        })
        .expect(201);
      expect(res.body).toMatchObject({ kind: 'TEAM', memberCount: 3, myRole: 'ADMIN' });
      const user = await ctx.prisma.user.findUnique({
        where: { email: 'future.member@lunatech.vn' },
      });
      expect(user).toMatchObject({ name: 'future.member', lastLoginAt: null });
      expect(await members(carol, res.body.id)).toEqual([
        ['bob@lunatech.vn', 'ADMIN'],
        ['carol@lunatech.vn', 'MEMBER'],
        ['future.member@lunatech.vn', 'MEMBER'],
      ]);
    });

    it('System Admin tạo workspace cũng thành quản trị của workspace đó', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Trống', slug: 'trong' })
        .expect(201);
      expect(res.body).toMatchObject({ memberCount: 1, myRole: 'ADMIN' });
      await http().delete(`/api/v1/workspaces/${res.body.id}`).set(admin.auth).expect(204);
    });

    it('slug trùng → 409 CONFLICT', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(bob.auth)
        .send({ name: 'M2', slug: 'marketing' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('validate dữ liệu: slug sai định dạng, email sai, email ngoài công ty', async () => {
      const bad = await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({ name: '', slug: 'Bad Slug', memberEmails: ['not-an-email'] })
        .expect(400);
      expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'memberEmails.0',
        'name',
        'slug',
      ]);
      const external = await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({ name: 'Ext', slug: 'ext', memberEmails: ['a@gmail.com'] })
        .expect(400);
      expect(external.body.error.message).toMatch(/company accounts/);
    });

    it('scope=all chỉ dành cho System Admin', async () => {
      await http().get('/api/v1/workspaces?scope=all').set(alice.auth).expect(403);
      const all = await http().get('/api/v1/workspaces?scope=all').set(admin.auth).expect(200);
      expect(all.body.map((w: { slug: string }) => w.slug)).toEqual(['marketing', 'sales']);
    });
  });

  describe('xem và sửa workspace', () => {
    it('người ngoài nhận 404 (không lộ workspace tồn tại)', async () => {
      const res = await http().get(`/api/v1/workspaces/${wsId}`).set(outsider.auth).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      await http().get(`/api/v1/workspaces/${wsId}/members`).set(outsider.auth).expect(404);
    });

    it('thành viên và System Admin xem được', async () => {
      const m = await http().get(`/api/v1/workspaces/${wsId}`).set(alice.auth).expect(200);
      expect(m.body.myRole).toBe('ADMIN');
      const a = await http().get(`/api/v1/workspaces/${wsId}`).set(admin.auth).expect(200);
      expect(a.body.myRole).toBeNull();
    });

    it('quản trị workspace và System Admin sửa được; người ngoài 404', async () => {
      await http()
        .patch(`/api/v1/workspaces/${wsId}`)
        .set(outsider.auth)
        .send({ description: 'x' })
        .expect(404);
      const own = await http()
        .patch(`/api/v1/workspaces/${wsId}`)
        .set(alice.auth)
        .send({ name: 'Marketing VN' })
        .expect(200);
      expect(own.body).toMatchObject({ name: 'Marketing VN', myRole: 'ADMIN' });
      const res = await http()
        .patch(`/api/v1/workspaces/${wsId}`)
        .set(admin.auth)
        .send({ description: 'Team Marketing', icon: null })
        .expect(200);
      expect(res.body).toMatchObject({ description: 'Team Marketing', icon: null, myRole: null });
    });
  });

  describe('thành viên', () => {
    it('quản trị thêm thành viên theo email (mặc định MEMBER); thêm trùng → 409', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(alice.auth)
        .send({ email: 'BOB@lunatech.vn' })
        .expect(201);
      expect(res.body).toMatchObject({ role: 'MEMBER', user: { email: 'bob@lunatech.vn' } });
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(alice.auth)
        .send({ email: 'bob@lunatech.vn' })
        .expect(409);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'workspace.member_add', targetId: bob.userId, workspaceId: wsId },
        }),
      ).toBe(1);
    });

    it('thành viên thường không thêm/đổi vai trò được (403); người ngoài 404', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(bob.auth)
        .send({ email: 'carol@lunatech.vn' })
        .expect(403);
      await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${bob.userId}`)
        .set(bob.auth)
        .send({ role: 'ADMIN' })
        .expect(403);
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(outsider.auth)
        .send({ email: 'carol@lunatech.vn' })
        .expect(404);
    });

    it('workspace nhóm không có vai trò VIEWER (400); thêm thẳng ADMIN được', async () => {
      const viewer = await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(alice.auth)
        .send({ email: 'carol@lunatech.vn', role: 'VIEWER' })
        .expect(400);
      expect(viewer.body.error.code).toBe('VALIDATION_ERROR');
      await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${bob.userId}`)
        .set(alice.auth)
        .send({ role: 'VIEWER' })
        .expect(400);
      const res = await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(admin.auth)
        .send({ email: 'carol@lunatech.vn', role: 'ADMIN' })
        .expect(201);
      expect(res.body.role).toBe('ADMIN');
    });

    it('danh sách thành viên sắp xếp ADMIN trước rồi theo tên', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(alice.auth)
        .send({ email: 'an.tran@lunatech.vn' })
        .expect(201);
      const res = await http().get(`/api/v1/workspaces/${wsId}/members`).set(bob.auth).expect(200);
      expect(
        res.body.map((m: { user: { name: string }; role: string }) => [m.user.name, m.role]),
      ).toEqual([
        ['Alice', 'ADMIN'],
        ['Carol', 'ADMIN'],
        ['an.tran', 'MEMBER'],
        ['Bob', 'MEMBER'],
      ]);
      expect(res.body[0]).toEqual({
        user: expect.objectContaining({ email: 'alice@lunatech.vn' }),
        role: 'ADMIN',
        createdAt: expect.any(String),
      });
    });

    it('quản trị đổi vai trò thành viên, có ghi nhật ký; người không phải thành viên → 404', async () => {
      const up = await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${bob.userId}`)
        .set(alice.auth)
        .send({ role: 'ADMIN' })
        .expect(200);
      expect(up.body).toMatchObject({ role: 'ADMIN', user: { email: 'bob@lunatech.vn' } });
      const log = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'workspace.member_update', targetId: bob.userId, workspaceId: wsId },
      });
      expect(log.metadata).toEqual({ from: 'MEMBER', to: 'ADMIN' });
      const down = await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${bob.userId}`)
        .set(admin.auth)
        .send({ role: 'MEMBER' })
        .expect(200);
      expect(down.body.role).toBe('MEMBER');
      await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${outsider.userId}`)
        .set(alice.auth)
        .send({ role: 'MEMBER' })
        .expect(404);
      await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${bob.userId}`)
        .set(alice.auth)
        .send({ role: 'OWNER' })
        .expect(400);
    });

    it('API chuyển quyền sở hữu không còn (404)', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/transfer-ownership`)
        .set(admin.auth)
        .send({ userId: bob.userId })
        .expect(404);
    });

    it('thành viên không gỡ được người khác; tự rời được', async () => {
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${alice.userId}`)
        .set(bob.auth)
        .expect(403);
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${bob.userId}`)
        .set(bob.auth)
        .expect(204);
      await http().get(`/api/v1/workspaces/${wsId}`).set(bob.auth).expect(404);
    });

    it('quản trị gỡ thành viên; System Admin gỡ được; gỡ người không phải thành viên → 404', async () => {
      const an = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'an.tran@lunatech.vn' },
      });
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${an.id}`)
        .set(alice.auth)
        .expect(204);
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${outsider.userId}`)
        .set(admin.auth)
        .expect(404);
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${carol.userId}`)
        .set(admin.auth)
        .expect(204);
      expect(await members(admin)).toEqual([['alice@lunatech.vn', 'ADMIN']]);
    });

    it('luôn phải còn một quản trị: không hạ vai trò, gỡ hay tự rời của quản trị cuối cùng', async () => {
      const demote = await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${alice.userId}`)
        .set(alice.auth)
        .send({ role: 'MEMBER' })
        .expect(400);
      expect(demote.body.error.code).toBe('VALIDATION_ERROR');
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${alice.userId}`)
        .set(alice.auth)
        .expect(400);
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${alice.userId}`)
        .set(admin.auth)
        .expect(400);

      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(alice.auth)
        .send({ email: 'bob@lunatech.vn', role: 'ADMIN' })
        .expect(201);
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${alice.userId}`)
        .set(alice.auth)
        .expect(204);
      expect(await members(bob)).toEqual([['bob@lunatech.vn', 'ADMIN']]);
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(bob.auth)
        .send({ email: 'alice@lunatech.vn', role: 'ADMIN' })
        .expect(201);
    });
  });

  describe('xóa workspace', () => {
    it('chỉ quản trị hoặc System Admin xóa được; sau khi xóa không còn truy cập được và slug được giải phóng', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(alice.auth)
        .send({ email: 'carol@lunatech.vn' })
        .expect(201);
      await http().delete(`/api/v1/workspaces/${wsId}`).set(carol.auth).expect(403);
      await http().delete(`/api/v1/workspaces/${wsId}`).set(outsider.auth).expect(404);
      await http().delete(`/api/v1/workspaces/${wsId}`).set(alice.auth).expect(204);
      await http().get(`/api/v1/workspaces/${wsId}`).set(alice.auth).expect(404);
      const mine = await http().get('/api/v1/workspaces').set(alice.auth).expect(200);
      expect(mine.body).toEqual([]);
      await http()
        .post('/api/v1/workspaces')
        .set(carol.auth)
        .send({ name: 'Marketing', slug: 'marketing' })
        .expect(201);
      const sales = await ctx.prisma.workspace.findUniqueOrThrow({ where: { slug: 'sales' } });
      await http().delete(`/api/v1/workspaces/${sales.id}`).set(admin.auth).expect(204);
    });
  });
});
