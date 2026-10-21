import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Admin: stats & audit logs (e2e)', () => {
  let ctx: TestContext;
  let admin: LoggedIn;
  let owner: LoggedIn;
  let editor: LoggedIn;
  let wsId: string;
  let folderId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    admin = await loginAsAdmin(ctx);
    owner = await loginAs(ctx, 'owner@lunatech.vn');
    editor = await loginAs(ctx, 'editor@lunatech.vn');
    wsId = (
      await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({
          name: 'Docs',
          slug: 'docs',
          memberEmails: ['owner@lunatech.vn', 'editor@lunatech.vn'],
        })
        .expect(201)
    ).body.id;
    folderId = (
      await http()
        .post(`/api/v1/workspaces/${wsId}/folders`)
        .set(editor.auth)
        .send({ name: 'Hợp đồng 2026' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('chỉ System Admin xem được', async () => {
    await http().get('/api/v1/admin/stats').set(owner.auth).expect(403);
    await http().get('/api/v1/admin/audit-logs').set(owner.auth).expect(403);
    await http().get('/api/v1/admin/audit-logs/export').set(owner.auth).expect(403);
  });

  it('ghi lượt xem khi mở mục, không ghi trùng trong 5 phút', async () => {
    await http().get(`/api/v1/nodes/${folderId}`).set(editor.auth).expect(200);
    await http().get(`/api/v1/nodes/${folderId}`).set(editor.auth).expect(200);
    const views = await ctx.prisma.auditLog.findMany({
      where: { action: 'node.view', targetId: folderId, actorId: editor.userId },
    });
    expect(views).toHaveLength(1);
    expect(views[0]!.metadata).toMatchObject({ type: 'FOLDER', name: 'Hợp đồng 2026' });
  });

  it('nhật ký có tên người, tên đối tượng, workspace; lọc theo người và hành động', async () => {
    const res = await http()
      .get(`/api/v1/admin/audit-logs?actorId=${editor.userId}&actions=node.view,node.create`)
      .set(admin.auth)
      .expect(200);
    expect(res.body.items.map((i: { action: string }) => i.action)).toEqual([
      'node.view',
      'node.create',
    ]);
    expect(res.body.items[0]).toMatchObject({
      actor: { email: 'editor@lunatech.vn' },
      target: { type: 'node', id: folderId, label: 'Hợp đồng 2026' },
      workspace: { id: wsId, name: 'Docs' },
    });
  });

  it('mục đã xoá hẳn vẫn hiện tên từ metadata', async () => {
    await http().delete(`/api/v1/nodes/${folderId}`).set(editor.auth).expect(204);
    await http().delete(`/api/v1/nodes/${folderId}/permanent`).set(owner.auth).expect(403);
    await http().delete(`/api/v1/nodes/${folderId}/permanent`).set(admin.auth).expect(204);
    const res = await http()
      .get(`/api/v1/admin/audit-logs?targetId=${folderId}&actions=node.delete_permanent`)
      .set(admin.auth)
      .expect(200);
    expect(res.body.items[0].target.label).toBe('Hợp đồng 2026');
  });

  it('phân trang cursor và lọc theo thời gian', async () => {
    const p1 = await http().get('/api/v1/admin/audit-logs?limit=2').set(admin.auth).expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await http()
      .get(`/api/v1/admin/audit-logs?limit=2&cursor=${p1.body.nextCursor}`)
      .set(admin.auth)
      .expect(200);
    expect(Number(p2.body.items[0].id)).toBeLessThan(Number(p1.body.items[1].id));
    const future = new Date(Date.now() + 3600_000).toISOString();
    const none = await http()
      .get(`/api/v1/admin/audit-logs?from=${future}`)
      .set(admin.auth)
      .expect(200);
    expect(none.body.items).toEqual([]);
  });

  it('xuất CSV có BOM, tiêu đề tiếng Việt và chặn công thức Excel', async () => {
    await ctx.prisma.auditLog.create({
      data: {
        action: 'test.csv',
        metadata: { name: '=HYPERLINK("x")' },
        targetType: 'node',
        targetId: 'gone',
      },
    });
    const res = await http()
      .get('/api/v1/admin/audit-logs/export?actions=test.csv')
      .set(admin.auth)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="nhat-ky-/);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('Thời gian,Người thực hiện');
    expect(res.text).toContain(`'=HYPERLINK(""x"")`);
  });

  it('số liệu tổng quan', async () => {
    const res = await http().get('/api/v1/admin/stats').set(admin.auth).expect(200);
    expect(res.body.users).toMatchObject({ total: 3, systemAdmins: 1, disabled: 0 });
    expect(res.body.users.activeLast7Days).toBeGreaterThanOrEqual(3);
    expect(res.body.workspaces.total).toBe(1);
    expect(res.body.activity.last7Days).toHaveLength(7);
    expect(res.body.activity.loginsLast7Days).toBeGreaterThanOrEqual(3);
  });

  it('danh sách workspace (scope=all) có số thành viên, không còn chủ sở hữu', async () => {
    const res = await http().get('/api/v1/workspaces?scope=all').set(admin.auth).expect(200);
    expect(res.body[0]).toMatchObject({ slug: 'docs', memberCount: 2, myRole: null });
    expect(res.body[0]).not.toHaveProperty('owner');
  });
});
