import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Workspace công ty (e2e)', () => {
  let ctx: TestContext;
  let admin: LoggedIn;
  let companyId: string;
  const http = () => request(ctx.app.getHttpServer());
  const workspacesOf = async (as: LoggedIn) =>
    (await http().get('/api/v1/me').set(as.auth).expect(200)).body.workspaces;
  const autoAdds = (userId: string) =>
    ctx.prisma.auditLog.count({
      where: { action: 'workspace.member_add', targetId: userId, workspaceId: companyId },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('chưa có workspace công ty thì người mới không thuộc workspace nào', async () => {
    const u = await loginAs(ctx, 'early@lunatech.vn');
    expect(await workspacesOf(u)).toEqual([]);
  });

  it('workspace công ty tạo trực tiếp trong DB; chỉ có một; POST /workspaces luôn tạo nhóm', async () => {
    admin = await loginAsAdmin(ctx);
    companyId = (
      await ctx.prisma.workspace.create({
        data: { name: 'Lunatech', slug: 'lunatech', kind: 'COMPANY', createdById: admin.userId },
      })
    ).id;
    await expect(
      ctx.prisma.workspace.create({
        data: { name: 'Khác', slug: 'cong-ty-khac', kind: 'COMPANY', createdById: admin.userId },
      }),
    ).rejects.toThrow();
    admin = await loginAsAdmin(ctx);
    await http()
      .patch(`/api/v1/workspaces/${companyId}/members/${admin.userId}`)
      .set(admin.auth)
      .send({ role: 'ADMIN' })
      .expect(200);
    const team = await http()
      .post('/api/v1/workspaces')
      .set(admin.auth)
      .send({ name: 'Nhóm', slug: 'nhom', kind: 'COMPANY' })
      .expect(201);
    expect(team.body.kind).toBe('TEAM');
    await http().delete(`/api/v1/workspaces/${team.body.id}`).set(admin.auth).expect(204);
  });

  it('mỗi lần đăng nhập đều được thêm vào workspace công ty với vai trò VIEWER, ghi nhật ký khi thật sự thêm', async () => {
    const u = await loginAs(ctx, 'newbie@lunatech.vn');
    expect(await workspacesOf(u)).toEqual([
      expect.objectContaining({ id: companyId, role: 'VIEWER' }),
    ]);
    const log = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'workspace.member_add', targetId: u.userId, workspaceId: companyId },
    });
    expect(log.metadata).toEqual({ auto: true });

    const early = await loginAs(ctx, 'early@lunatech.vn');
    expect(await workspacesOf(early)).toEqual([
      expect.objectContaining({ id: companyId, role: 'VIEWER' }),
    ]);

    await loginAs(ctx, 'newbie@lunatech.vn');
    expect(await autoAdds(u.userId)).toBe(1);
  });

  it('bị xoá khỏi workspace công ty trong DB thì đăng nhập lại được thêm lại', async () => {
    const newbie = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'newbie@lunatech.vn' },
    });
    await ctx.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: companyId, userId: newbie.id } },
    });
    const again = await loginAs(ctx, 'newbie@lunatech.vn');
    expect(await workspacesOf(again)).toEqual([
      expect.objectContaining({ id: companyId, role: 'VIEWER' }),
    ]);
    expect(await autoAdds(newbie.id)).toBe(2);
  });

  it('user được tạo khi thêm thành viên hoặc chia sẻ cũng vào workspace công ty (VIEWER)', async () => {
    const owner = await loginAs(ctx, 'team.owner@lunatech.vn');
    const team = await http()
      .post('/api/v1/workspaces')
      .set(owner.auth)
      .send({ name: 'Kế toán', slug: 'ke-toan', memberEmails: ['invited.member@lunatech.vn'] })
      .expect(201);
    const folder = await http()
      .post(`/api/v1/workspaces/${team.body.id}/folders`)
      .set(owner.auth)
      .send({ name: 'Chia sẻ' })
      .expect(201);
    await http()
      .post(`/api/v1/nodes/${folder.body.id}/shares`)
      .set(owner.auth)
      .send({ email: 'invited.guest@lunatech.vn', role: 'VIEWER' })
      .expect(201);
    const roles = async (email: string) =>
      (
        await ctx.prisma.user.findUniqueOrThrow({
          where: { email },
          include: { memberships: { include: { workspace: true } } },
        })
      ).memberships
        .map((m) => [m.workspace.slug, m.role])
        .sort();
    expect(await roles('invited.member@lunatech.vn')).toEqual([
      ['ke-toan', 'MEMBER'],
      ['lunatech', 'VIEWER'],
    ]);
    expect(await roles('invited.guest@lunatech.vn')).toEqual([['lunatech', 'VIEWER']]);
  });

  it('danh sách workspace: công ty đứng đầu', async () => {
    const owner = await loginAs(ctx, 'team.owner@lunatech.vn');
    const res = await http().get('/api/v1/workspaces').set(owner.auth).expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({ slug: 'lunatech', kind: 'COMPANY', myRole: 'VIEWER' }),
      expect.objectContaining({ slug: 'ke-toan', kind: 'TEAM', myRole: 'ADMIN' }),
    ]);
  });

  it('không ai bị gỡ khỏi workspace công ty, kể cả tự rời; không xoá được workspace công ty', async () => {
    const early = await loginAs(ctx, 'early@lunatech.vn');
    await http()
      .delete(`/api/v1/workspaces/${companyId}/members/${early.userId}`)
      .set(early.auth)
      .expect(403);
    await http()
      .delete(`/api/v1/workspaces/${companyId}/members/${early.userId}`)
      .set(admin.auth)
      .expect(403);
    await http().delete(`/api/v1/workspaces/${companyId}`).set(admin.auth).expect(403);
    await http().delete(`/api/v1/workspaces/${companyId}`).set(early.auth).expect(403);
    const ws = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: companyId } });
    expect(ws.deletedAt).toBeNull();
  });

  it('VIEWER của công ty xem được nội dung, bình luận; không tạo, đổi tên, xoá, gắn tag, xem thùng rác', async () => {
    const early = await loginAs(ctx, 'early@lunatech.vn');
    const folder = await http()
      .post(`/api/v1/workspaces/${companyId}/folders`)
      .set(admin.auth)
      .send({ name: 'Nội quy' })
      .expect(201);
    const doc = await http()
      .post(`/api/v1/workspaces/${companyId}/documents`)
      .set(admin.auth)
      .send({ name: 'Quy định chung', parentId: folder.body.id })
      .expect(201);
    const docId = doc.body.node.id as string;

    const list = await http()
      .get(`/api/v1/workspaces/${companyId}/nodes`)
      .set(early.auth)
      .expect(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: folder.body.id, myRole: 'VIEWER' }),
    ]);
    const read = await http().get(`/api/v1/documents/${docId}`).set(early.auth).expect(200);
    expect(read.body.readOnly).toBe(true);
    await http()
      .post(`/api/v1/documents/${docId}/threads`)
      .set(early.auth)
      .send({ body: 'Cho em hỏi' })
      .expect(201);
    await http().get(`/api/v1/workspaces/${companyId}/tags`).set(early.auth).expect(200);

    await http()
      .post(`/api/v1/workspaces/${companyId}/folders`)
      .set(early.auth)
      .send({ name: 'Không được' })
      .expect(403);
    await http()
      .post(`/api/v1/workspaces/${companyId}/folders`)
      .set(early.auth)
      .send({ name: 'Không được', parentId: folder.body.id })
      .expect(403);
    await http()
      .post(`/api/v1/workspaces/${companyId}/documents`)
      .set(early.auth)
      .send({ name: 'Không được' })
      .expect(403);
    await http()
      .post(`/api/v1/workspaces/${companyId}/uploads`)
      .set(early.auth)
      .send({ fileName: 'a.pdf', size: 10 })
      .expect(403);
    await http()
      .patch(`/api/v1/nodes/${folder.body.id}`)
      .set(early.auth)
      .send({ name: 'x' })
      .expect(403);
    await http().delete(`/api/v1/nodes/${folder.body.id}`).set(early.auth).expect(403);
    await http()
      .post(`/api/v1/workspaces/${companyId}/tags`)
      .set(early.auth)
      .send({ name: 'x', color: '#000000' })
      .expect(403);
    await http().get(`/api/v1/workspaces/${companyId}/trash`).set(early.auth).expect(403);
    await http()
      .post(`/api/v1/workspaces/${companyId}/members`)
      .set(early.auth)
      .send({ email: 'newbie@lunatech.vn', role: 'ADMIN' })
      .expect(403);
  });

  it('System Admin nâng một người lên MEMBER của công ty: người đó tạo được nội dung', async () => {
    const early = await loginAs(ctx, 'early@lunatech.vn');
    const res = await http()
      .patch(`/api/v1/workspaces/${companyId}/members/${early.userId}`)
      .set(admin.auth)
      .send({ role: 'MEMBER' })
      .expect(200);
    expect(res.body).toMatchObject({ role: 'MEMBER', user: { email: 'early@lunatech.vn' } });
    expect(await workspacesOf(early)).toEqual([
      expect.objectContaining({ id: companyId, role: 'MEMBER' }),
    ]);
    const created = await http()
      .post(`/api/v1/workspaces/${companyId}/folders`)
      .set(early.auth)
      .send({ name: 'Của Early' })
      .expect(201);
    expect(created.body.myRole).toBe('EDITOR');
    await http().get(`/api/v1/workspaces/${companyId}/trash`).set(early.auth).expect(200);

    await loginAs(ctx, 'early@lunatech.vn');
    expect(
      (
        await ctx.prisma.workspaceMember.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: companyId, userId: early.userId } },
        })
      ).role,
    ).toBe('MEMBER');
  });

  it('quản trị công ty đặt vai trò qua thêm thành viên theo email; VIEWER hợp lệ ở công ty', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${companyId}/members`)
      .set(admin.auth)
      .send({ email: 'newbie@lunatech.vn', role: 'ADMIN' })
      .expect(201);
    expect(res.body.role).toBe('ADMIN');
    const newbie = await loginAs(ctx, 'newbie@lunatech.vn');
    const early = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'early@lunatech.vn' },
    });
    const back = await http()
      .patch(`/api/v1/workspaces/${companyId}/members/${early.id}`)
      .set(newbie.auth)
      .send({ role: 'VIEWER' })
      .expect(200);
    expect(back.body.role).toBe('VIEWER');
    const fresh = await http()
      .post(`/api/v1/workspaces/${companyId}/members`)
      .set(newbie.auth)
      .send({ email: 'brand.new@lunatech.vn', role: 'MEMBER' })
      .expect(201);
    expect(fresh.body).toMatchObject({ role: 'MEMBER', user: { email: 'brand.new@lunatech.vn' } });
    const membersRes = await http()
      .get(`/api/v1/workspaces/${companyId}/members`)
      .set(newbie.auth)
      .expect(200);
    expect(membersRes.body.map((m: { role: string }) => m.role)).toEqual([
      'ADMIN',
      'ADMIN',
      'MEMBER',
      'VIEWER',
      'VIEWER',
      'VIEWER',
      'VIEWER',
    ]);
    expect(
      membersRes.body
        .filter((m: { role: string }) => m.role === 'ADMIN')
        .map((m: { user: { email: string } }) => m.user.email),
    ).toEqual(['admin@lunatech.vn', 'newbie@lunatech.vn']);
  });

  it('GET /users/admins trả quản trị hệ thống đang hoạt động', async () => {
    const u = await loginAs(ctx, 'early@lunatech.vn');
    const res = await http().get('/api/v1/users/admins').set(u.auth).expect(200);
    expect(res.body.map((a: { email: string }) => a.email)).toEqual(['admin@lunatech.vn']);
  });
});
