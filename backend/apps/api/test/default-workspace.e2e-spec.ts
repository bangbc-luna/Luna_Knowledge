import request from 'supertest';
import {
  createTestApp,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Workspace chung cho người dùng mới (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('chưa có workspace chung thì người mới không thuộc workspace nào', async () => {
    const u = await loginAs(ctx, 'early@lunatech.vn');
    const me = await http().get('/api/v1/me').set(u.auth).expect(200);
    expect(me.body.workspaces).toEqual([]);
  });

  it('có workspace chung: người đăng nhập lần đầu tự vào với vai trò MEMBER, có ghi nhật ký', async () => {
    const admin = await loginAsAdmin(ctx);
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(admin.auth)
      .send({ name: 'Lunatech', slug: 'lunatech' })
      .expect(201);
    const u = await loginAs(ctx, 'newbie@lunatech.vn');
    const me = await http().get('/api/v1/me').set(u.auth).expect(200);
    expect(me.body.workspaces).toEqual([
      expect.objectContaining({ id: ws.body.id, role: 'MEMBER' }),
    ]);
    const log = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'workspace.member_add', targetId: u.userId },
    });
    expect(log.metadata).toEqual({ auto: true });
  });

  it('người đã có tài khoản không bị thêm lại; bị xoá khỏi workspace chung thì đăng nhập lại vẫn không tự vào', async () => {
    const early = await loginAs(ctx, 'early@lunatech.vn');
    expect((await http().get('/api/v1/me').set(early.auth)).body.workspaces).toEqual([]);
    const ws = await ctx.prisma.workspace.findUniqueOrThrow({ where: { slug: 'lunatech' } });
    const newbie = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'newbie@lunatech.vn' },
    });
    await ctx.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: newbie.id } },
    });
    const again = await loginAs(ctx, 'newbie@lunatech.vn');
    expect((await http().get('/api/v1/me').set(again.auth)).body.workspaces).toEqual([]);
  });

  it('user được tạo khi chia sẻ/thêm thành viên cũng vào workspace chung', async () => {
    const admin = await loginAsAdmin(ctx);
    const other = await http()
      .post('/api/v1/workspaces')
      .set(admin.auth)
      .send({ name: 'Kế toán', slug: 'ke-toan', memberEmails: ['invited.member@lunatech.vn'] })
      .expect(201);
    const invited = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'invited.member@lunatech.vn' },
      include: { memberships: { include: { workspace: true } } },
    });
    expect(invited.memberships.map((m) => [m.workspace.slug, m.role]).sort()).toEqual([
      ['ke-toan', 'MEMBER'],
      ['lunatech', 'MEMBER'],
    ]);
    expect(other.body.id).toBeTruthy();
  });

  it('GET /users/admins trả quản trị hệ thống đang hoạt động', async () => {
    const u = await loginAs(ctx, 'early@lunatech.vn');
    const res = await http().get('/api/v1/users/admins').set(u.auth).expect(200);
    expect(res.body.map((a: { email: string }) => a.email)).toEqual(['admin@lunatech.vn']);
  });
});
