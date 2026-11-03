import { randomUUID } from 'node:crypto';
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
        .set(owner.auth)
        .send({ name: 'Docs', slug: 'docs', memberEmails: ['editor@lunatech.vn'] })
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
    await http().delete(`/api/v1/nodes/${folderId}/permanent`).set(editor.auth).expect(403);
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
    await ctx.prisma.auditLog.create({
      data: {
        action: 'test.csv',
        metadata: { name: '\t=SUM(A1)' },
        targetType: 'node',
        targetId: randomUUID(),
      },
    });
    await ctx.prisma.auditLog.create({
      data: {
        action: 'test.csv',
        metadata: { name: '\r=1+1' },
        targetType: 'node',
        targetId: randomUUID(),
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
    expect(res.text).toContain("'\t=SUM(A1)");
    expect(res.text).toContain(`"'\r=1+1"`);
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
    expect(res.body[0]).toMatchObject({
      slug: 'docs',
      kind: 'TEAM',
      memberCount: 2,
      myRole: null,
    });
    expect(res.body[0]).not.toHaveProperty('owner');
  });

  it('thống kê phút họp theo tháng và workspace; người không phải admin 403', async () => {
    const ws2 = (
      await http()
        .post('/api/v1/workspaces')
        .set(owner.auth)
        .send({ name: 'Sales', slug: 'sales' })
        .expect(201)
    ).body.id;
    const at = (iso: string) => new Date(iso);
    const mk = (workspaceId: string, data: Record<string, unknown>) =>
      ctx.prisma.meeting.create({
        data: { workspaceId, createdById: owner.userId, title: 'Họp', ...data } as never,
      });
    const a = await mk(wsId, {
      status: 'ENDED',
      startedAt: at('2026-03-31T17:30:00Z'),
      endedAt: at('2026-03-31T18:20:30Z'),
    });
    const b = await mk(ws2, {
      status: 'ENDED',
      startedAt: at('2026-05-10T03:00:00Z'),
      endedAt: at('2026-05-10T03:10:00Z'),
    });
    await mk(wsId, { status: 'SCHEDULED', scheduledAt: at('2026-04-10T03:00:00Z') });
    await mk(wsId, {
      status: 'CANCELLED',
      startedAt: at('2026-04-12T03:00:00Z'),
      endedAt: at('2026-04-12T04:00:00Z'),
    });
    const sessions = [
      {
        meetingId: a.id,
        userId: owner.userId,
        joinedAt: '2026-03-31T17:30:00Z',
        leftAt: '2026-03-31T18:15:00Z',
      },
      {
        meetingId: a.id,
        userId: editor.userId,
        joinedAt: '2026-03-31T17:40:00Z',
        leftAt: '2026-03-31T18:10:00Z',
      },
      {
        meetingId: b.id,
        userId: owner.userId,
        joinedAt: '2026-05-10T03:00:00Z',
        leftAt: '2026-05-10T03:00:10Z',
      },
      { meetingId: b.id, userId: editor.userId, joinedAt: '2026-05-10T03:05:00Z', leftAt: null },
    ];
    await ctx.prisma.meetingAttendance.createMany({
      data: sessions.map((s) => ({
        ...s,
        joinedAt: at(s.joinedAt),
        leftAt: s.leftAt ? at(s.leftAt) : null,
      })),
    });

    await http()
      .get('/api/v1/admin/meetings/usage?from=2026-03&to=2026-05')
      .set(owner.auth)
      .expect(403);

    const res = await http()
      .get('/api/v1/admin/meetings/usage?from=2026-03&to=2026-05')
      .set(admin.auth)
      .expect(200);
    expect(res.body.months.map((m: { month: string }) => m.month)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    const [mar, apr, may] = res.body.months;
    expect(mar).toMatchObject({
      meetings: 0,
      roomMinutes: 0,
      participantMinutes: 0,
      byWorkspace: [],
    });
    expect(apr).toMatchObject({ meetings: 1, roomMinutes: 51, participantMinutes: 75 });
    expect(apr.byWorkspace).toEqual([
      { workspaceId: wsId, name: 'Docs', meetings: 1, participantMinutes: 75 },
    ]);
    expect(may).toMatchObject({ meetings: 1, roomMinutes: 10, participantMinutes: 1 });
    expect(may.byWorkspace).toEqual([
      { workspaceId: ws2, name: 'Sales', meetings: 1, participantMinutes: 1 },
    ]);
  });

  it('chi phí AI theo tháng cộng đúng micro USD; dòng chi phí của buổi họp đã xoá vẫn được tính', async () => {
    const at = (iso: string) => new Date(iso);
    const ws = (
      await http()
        .post('/api/v1/workspaces')
        .set(owner.auth)
        .send({ name: 'Ops', slug: 'ops' })
        .expect(201)
    ).body.id;
    const mk = (startedAt: Date) =>
      ctx.prisma.meeting.create({
        data: {
          workspaceId: ws,
          createdById: owner.userId,
          title: 'Họp AI',
          status: 'ENDED',
          startedAt,
          endedAt: new Date(startedAt.getTime() + 600_000),
        },
      });
    const kept = await mk(at('2026-07-10T03:00:00Z'));
    const doomed = await mk(at('2026-07-20T03:00:00Z'));
    await mk(at('2026-07-25T03:00:00Z'));
    const row = (data: Record<string, unknown>) => ({
      workspaceId: ws,
      provider: 'omniroute',
      model: 'm',
      ...data,
    });
    await ctx.prisma.meetingAiUsage.createMany({
      data: [
        row({ meetingId: kept.id, kind: 'stt', audioMs: 90_000, costMicroUsd: 1_500n }),
        row({ meetingId: kept.id, kind: 'stt', audioMs: 30_000, costMicroUsd: 500n }),
        row({
          meetingId: kept.id,
          kind: 'llm',
          inputTokens: 1000,
          outputTokens: 200,
          costMicroUsd: 2_000n,
        }),
        row({
          meetingId: doomed.id,
          kind: 'stt',
          audioMs: 60_000,
          costMicroUsd: 1_000n,
          createdAt: at('2026-07-20T04:00:00Z'),
        }),
        row({
          meetingId: doomed.id,
          kind: 'llm',
          inputTokens: 500,
          outputTokens: 100,
          costMicroUsd: 3_000n,
          createdAt: at('2026-07-20T04:00:00Z'),
        }),
        row({
          meetingId: null,
          kind: 'llm',
          inputTokens: 10,
          outputTokens: 5,
          costMicroUsd: 250n,
          createdAt: at('2026-07-31T17:30:00Z'),
        }),
      ] as never,
    });
    await ctx.prisma.meeting.delete({ where: { id: doomed.id } });

    const res = await http()
      .get('/api/v1/admin/meetings/usage?from=2026-07&to=2026-08')
      .set(admin.auth)
      .expect(200);
    const [jul, aug] = res.body.months;
    expect(jul).toMatchObject({
      meetings: 2,
      sttMinutes: 3,
      llmInputTokens: 1500,
      llmOutputTokens: 300,
      aiCostMicroUsd: 8_000,
      aiCostUsd: 0.008,
      liveKitEstimateUsd: 0,
    });
    expect(aug).toMatchObject({
      meetings: 0,
      sttMinutes: 0,
      llmInputTokens: 10,
      llmOutputTokens: 5,
      aiCostMicroUsd: 250,
      aiCostUsd: 0.00025,
    });
  });

  it('khoảng tháng sai hoặc quá 24 tháng trả 400', async () => {
    const get = (q: string) => http().get(`/api/v1/admin/meetings/usage?${q}`).set(admin.auth);
    await get('from=2026-05&to=2026-03').expect(400);
    await get('from=2026-13&to=2026-14').expect(400);
    await get('from=2024-01&to=2026-01').expect(400);
    await get('from=2024-02&to=2026-01').expect(200);
    await get('from=2026-01').expect(400);
  });
});
