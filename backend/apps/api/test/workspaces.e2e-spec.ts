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
  let outsider: LoggedIn;
  let wsId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    admin = await loginAsAdmin(ctx);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    outsider = await loginAs(ctx, 'outsider@lunatech.vn');
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('tạo workspace', () => {
    it('user thường không tạo được (403)', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({ name: 'X', slug: 'x-ws' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('System Admin tạo workspace kèm thành viên ban đầu; người tạo không tự thành thành viên', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({
          name: 'Marketing',
          slug: 'marketing',
          icon: '📣',
          memberEmails: ['ALICE@lunatech.vn', 'alice@lunatech.vn'],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Marketing',
        slug: 'marketing',
        memberCount: 1,
        myRole: null,
      });
      expect(res.body).not.toHaveProperty('owner');
      wsId = res.body.id;

      const mine = await http().get('/api/v1/workspaces').set(alice.auth).expect(200);
      expect(mine.body).toEqual([expect.objectContaining({ id: wsId, myRole: 'MEMBER' })]);
      const adminMine = await http().get('/api/v1/workspaces').set(admin.auth).expect(200);
      expect(adminMine.body).toEqual([]);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'workspace.create' } })).toBe(1);
    });

    it('thành viên chưa đăng nhập lần nào được tạo trước theo email', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Sales', slug: 'sales', memberEmails: ['future.member@lunatech.vn'] })
        .expect(201);
      expect(res.body.memberCount).toBe(1);
      const user = await ctx.prisma.user.findUnique({
        where: { email: 'future.member@lunatech.vn' },
      });
      expect(user).toMatchObject({ name: 'future.member', lastLoginAt: null });
    });

    it('tạo không kèm thành viên → workspace rỗng', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Trống', slug: 'trong' })
        .expect(201);
      expect(res.body.memberCount).toBe(0);
      await http().delete(`/api/v1/workspaces/${res.body.id}`).set(admin.auth).expect(204);
    });

    it('slug trùng → 409 CONFLICT', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'M2', slug: 'marketing' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('validate dữ liệu: slug sai định dạng, email sai, email ngoài công ty', async () => {
      const bad = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: '', slug: 'Bad Slug', memberEmails: ['not-an-email'] })
        .expect(400);
      expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'memberEmails.0',
        'name',
        'slug',
      ]);
      const external = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
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
      expect(m.body.myRole).toBe('MEMBER');
      const a = await http().get(`/api/v1/workspaces/${wsId}`).set(admin.auth).expect(200);
      expect(a.body.myRole).toBeNull();
    });

    it('thành viên không sửa được (403); System Admin sửa được', async () => {
      await http()
        .patch(`/api/v1/workspaces/${wsId}`)
        .set(alice.auth)
        .send({ description: 'x' })
        .expect(403);
      await http()
        .patch(`/api/v1/workspaces/${wsId}`)
        .set(outsider.auth)
        .send({ description: 'x' })
        .expect(404);
      const res = await http()
        .patch(`/api/v1/workspaces/${wsId}`)
        .set(admin.auth)
        .send({ description: 'Team Marketing', icon: null })
        .expect(200);
      expect(res.body).toMatchObject({ description: 'Team Marketing', icon: null, myRole: null });
    });
  });

  describe('thành viên', () => {
    it('thành viên không thêm được thành viên (403)', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(alice.auth)
        .send({ email: 'bob@lunatech.vn' })
        .expect(403);
    });

    it('System Admin thêm thành viên theo email; thêm trùng → 409', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(admin.auth)
        .send({ email: 'BOB@lunatech.vn' })
        .expect(201);
      expect(res.body).toMatchObject({ role: 'MEMBER', user: { email: 'bob@lunatech.vn' } });
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(admin.auth)
        .send({ email: 'bob@lunatech.vn' })
        .expect(409);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'workspace.member_add', targetId: bob.userId, workspaceId: wsId },
        }),
      ).toBe(1);
    });

    it('danh sách thành viên sắp xếp theo tên, mọi người đều là MEMBER', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(admin.auth)
        .send({ email: 'an.tran@lunatech.vn' })
        .expect(201);
      const res = await http().get(`/api/v1/workspaces/${wsId}/members`).set(bob.auth).expect(200);
      expect(res.body.map((m: { user: { name: string } }) => m.user.name)).toEqual([
        'Alice',
        'an.tran',
        'Bob',
      ]);
      expect(new Set(res.body.map((m: { role: string }) => m.role))).toEqual(new Set(['MEMBER']));
      expect(res.body[0]).toEqual({
        user: expect.objectContaining({ email: 'alice@lunatech.vn' }),
        role: 'MEMBER',
        createdAt: expect.any(String),
      });
    });

    it('API đổi vai trò và chuyển quyền sở hữu không còn (404)', async () => {
      await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${bob.userId}`)
        .set(admin.auth)
        .send({ role: 'MEMBER' })
        .expect(404);
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

    it('System Admin gỡ thành viên; gỡ người không phải thành viên → 404', async () => {
      const an = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'an.tran@lunatech.vn' },
      });
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${an.id}`)
        .set(admin.auth)
        .expect(204);
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${outsider.userId}`)
        .set(admin.auth)
        .expect(404);
      const res = await http()
        .get(`/api/v1/workspaces/${wsId}/members`)
        .set(admin.auth)
        .expect(200);
      expect(res.body.map((m: { user: { email: string } }) => m.user.email)).toEqual([
        'alice@lunatech.vn',
      ]);
    });
  });

  describe('xóa workspace', () => {
    it('chỉ System Admin xóa được; sau khi xóa không còn truy cập được và slug được giải phóng', async () => {
      await http().delete(`/api/v1/workspaces/${wsId}`).set(alice.auth).expect(403);
      await http().delete(`/api/v1/workspaces/${wsId}`).set(admin.auth).expect(204);
      await http().get(`/api/v1/workspaces/${wsId}`).set(alice.auth).expect(404);
      const mine = await http().get('/api/v1/workspaces').set(alice.auth).expect(200);
      expect(mine.body).toEqual([]);
      await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Marketing', slug: 'marketing' })
        .expect(201);
    });
  });
});
