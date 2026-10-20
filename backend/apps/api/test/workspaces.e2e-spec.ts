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
  let owner: LoggedIn;
  let editor: LoggedIn;
  let outsider: LoggedIn;
  let wsId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    admin = await loginAsAdmin(ctx);
    owner = await loginAs(ctx, 'owner@lunatech.vn');
    editor = await loginAs(ctx, 'editor@lunatech.vn');
    outsider = await loginAs(ctx, 'outsider@lunatech.vn');
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('tạo workspace', () => {
    it('user thường không tạo được (403)', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(owner.auth)
        .send({ name: 'X', slug: 'x-ws', ownerEmail: 'owner@lunatech.vn' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('System Admin tạo workspace và chỉ định OWNER', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Marketing', slug: 'marketing', icon: '📣', ownerEmail: 'OWNER@lunatech.vn' })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Marketing',
        slug: 'marketing',
        memberCount: 1,
        myRole: null,
      });
      wsId = res.body.id;

      const mine = await http().get('/api/v1/workspaces').set(owner.auth).expect(200);
      expect(mine.body).toEqual([expect.objectContaining({ id: wsId, myRole: 'OWNER' })]);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'workspace.create' } })).toBe(1);
    });

    it('owner chưa đăng nhập lần nào được tạo trước theo email', async () => {
      await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Sales', slug: 'sales', ownerEmail: 'future.owner@lunatech.vn' })
        .expect(201);
      const user = await ctx.prisma.user.findUnique({
        where: { email: 'future.owner@lunatech.vn' },
      });
      expect(user).toMatchObject({ name: 'future.owner', lastLoginAt: null });
    });

    it('slug trùng → 409 CONFLICT', async () => {
      const res = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'M2', slug: 'marketing', ownerEmail: 'owner@lunatech.vn' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('validate dữ liệu: slug sai định dạng, email ngoài công ty', async () => {
      const bad = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: '', slug: 'Bad Slug', ownerEmail: 'not-an-email' })
        .expect(400);
      expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'name',
        'ownerEmail',
        'slug',
      ]);
      const external = await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Ext', slug: 'ext', ownerEmail: 'a@gmail.com' })
        .expect(400);
      expect(external.body.error.message).toMatch(/company accounts/);
    });

    it('scope=all chỉ dành cho System Admin', async () => {
      await http().get('/api/v1/workspaces?scope=all').set(owner.auth).expect(403);
      const all = await http().get('/api/v1/workspaces?scope=all').set(admin.auth).expect(200);
      expect(all.body.map((w: { slug: string }) => w.slug)).toEqual(['marketing', 'sales']);
    });
  });

  describe('xem và sửa workspace', () => {
    it('người ngoài nhận 404 (không lộ workspace tồn tại)', async () => {
      const res = await http().get(`/api/v1/workspaces/${wsId}`).set(outsider.auth).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('OWNER sửa được thông tin', async () => {
      const res = await http()
        .patch(`/api/v1/workspaces/${wsId}`)
        .set(owner.auth)
        .send({ description: 'Team Marketing', icon: null })
        .expect(200);
      expect(res.body).toMatchObject({
        description: 'Team Marketing',
        icon: null,
        myRole: 'OWNER',
      });
    });
  });

  describe('thành viên', () => {
    it('OWNER thêm thành viên theo email', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(owner.auth)
        .send({ email: 'editor@lunatech.vn', role: 'EDITOR' })
        .expect(201);
      expect(res.body).toMatchObject({ role: 'EDITOR', user: { email: 'editor@lunatech.vn' } });
    });

    it('thêm trùng → 409', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(owner.auth)
        .send({ email: 'editor@lunatech.vn', role: 'VIEWER' })
        .expect(409);
    });

    it('không gán trực tiếp được vai trò OWNER', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(owner.auth)
        .send({ email: 'someone@lunatech.vn', role: 'OWNER' })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('role');
    });

    it('EDITOR không thêm được thành viên (403)', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(editor.auth)
        .send({ email: 'v@lunatech.vn', role: 'VIEWER' })
        .expect(403);
    });

    it('ADMIN không tự nâng mình lên OWNER và không đổi được vai trò của OWNER', async () => {
      await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${editor.userId}`)
        .set(owner.auth)
        .send({ role: 'ADMIN' })
        .expect(200);

      await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${editor.userId}`)
        .set(editor.auth)
        .send({ role: 'OWNER' })
        .expect(400);
      await http()
        .patch(`/api/v1/workspaces/${wsId}/members/${owner.userId}`)
        .set(editor.auth)
        .send({ role: 'VIEWER' })
        .expect(403);
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${owner.userId}`)
        .set(editor.auth)
        .expect(403);
      // ADMIN không gọi được API chuyển quyền sở hữu.
      await http()
        .post(`/api/v1/workspaces/${wsId}/transfer-ownership`)
        .set(editor.auth)
        .send({ userId: editor.userId })
        .expect(403);
    });

    it('danh sách thành viên sắp xếp theo vai trò', async () => {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(editor.auth)
        .send({ email: 'viewer@lunatech.vn', role: 'VIEWER' })
        .expect(201);
      const res = await http()
        .get(`/api/v1/workspaces/${wsId}/members`)
        .set(editor.auth)
        .expect(200);
      expect(res.body.map((m: { role: string }) => m.role)).toEqual(['OWNER', 'ADMIN', 'VIEWER']);
    });

    it('chuyển quyền sở hữu: OWNER cũ thành ADMIN', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${wsId}/transfer-ownership`)
        .set(owner.auth)
        .send({ userId: editor.userId })
        .expect(200);
      const roles = Object.fromEntries(
        res.body.map((m: { user: { email: string }; role: string }) => [m.user.email, m.role]),
      );
      expect(roles).toMatchObject({ 'editor@lunatech.vn': 'OWNER', 'owner@lunatech.vn': 'ADMIN' });
    });

    it('thành viên tự rời workspace; OWNER không rời được', async () => {
      const viewer = await loginAs(ctx, 'viewer@lunatech.vn');
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${viewer.userId}`)
        .set(viewer.auth)
        .expect(204);
      await http().get(`/api/v1/workspaces/${wsId}`).set(viewer.auth).expect(404);

      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${editor.userId}`)
        .set(editor.auth)
        .expect(403);
    });
  });

  describe('xóa workspace', () => {
    it('chỉ OWNER xóa được; sau khi xóa không còn truy cập được và slug được giải phóng', async () => {
      await http().delete(`/api/v1/workspaces/${wsId}`).set(owner.auth).expect(403);
      await http().delete(`/api/v1/workspaces/${wsId}`).set(editor.auth).expect(204);
      await http().get(`/api/v1/workspaces/${wsId}`).set(editor.auth).expect(404);
      const mine = await http().get('/api/v1/workspaces').set(editor.auth).expect(200);
      expect(mine.body).toEqual([]);
      await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Marketing', slug: 'marketing', ownerEmail: 'owner@lunatech.vn' })
        .expect(201);
    });
  });
});
