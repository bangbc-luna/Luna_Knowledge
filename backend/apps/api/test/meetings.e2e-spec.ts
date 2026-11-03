import { QUEUES, redisConnection } from '@luna/shared';
import { Queue } from 'bullmq';
import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Meetings (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let vera: LoggedIn;
  let outsider: LoggedIn;
  let wsId: string;
  const http = () => request(ctx.app.getHttpServer());
  const create = (as: LoggedIn, body: Record<string, unknown>, ws = wsId) =>
    http().post(`/api/v1/workspaces/${ws}/meetings`).set(as.auth).send(body);
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const notificationsOf = (userId: string, type: string) =>
    ctx.prisma.notification.findMany({ where: { userId, type } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    vera = await loginAs(ctx, 'vera@lunatech.vn', { name: 'Vera' });
    outsider = await loginAs(ctx, 'outsider@lunatech.vn', { name: 'Outsider' });
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .send({ name: 'Meet', slug: 'meet', kind: 'TEAM' })
      .expect(201);
    wsId = ws.body.id;
    await ctx.prisma.workspaceMember.createMany({
      data: [
        { workspaceId: wsId, userId: bob.userId, role: 'MEMBER' },
        { workspaceId: wsId, userId: vera.userId, role: 'VIEWER' },
      ],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('tạo họp ngay và đặt lịch: MEMBER/ADMIN tạo được, VIEWER 403, người ngoài 404; ghi audit meeting.create', async () => {
    const instant = await create(bob, { title: ' Họp nhanh ', mode: 'instant' }).expect(201);
    expect(instant.body).toMatchObject({
      workspaceId: wsId,
      title: 'Họp nhanh',
      status: 'SCHEDULED',
      startedAt: null,
      endedAt: null,
      aiNotesEnabled: true,
      aiNotesAvailable: true,
      attendeeCount: 0,
      createdBy: { id: bob.userId },
    });
    expect(instant.body.scheduledAt).toBeTruthy();

    const at = inHours(2);
    const scheduled = await create(alice, {
      title: 'Planning',
      mode: 'scheduled',
      scheduledAt: at,
      aiNotesEnabled: false,
    }).expect(201);
    expect(scheduled.body).toMatchObject({ aiNotesEnabled: false });
    expect(new Date(scheduled.body.scheduledAt).toISOString()).toBe(at);

    await create(vera, { title: 'x', mode: 'instant' }).expect(403);
    await create(outsider, { title: 'x', mode: 'instant' }).expect(404);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'meeting.create', targetId: scheduled.body.id },
    });
    expect(audit).toMatchObject({ actorId: alice.userId, workspaceId: wsId });
    expect(audit?.metadata).toMatchObject({
      title: 'Planning',
      mode: 'scheduled',
      aiNotesEnabled: false,
      inviteeCount: 0,
    });
  });

  it('đặt lịch thiếu giờ hoặc giờ trong quá khứ → 400', async () => {
    await create(alice, { title: 'x', mode: 'scheduled' }).expect(400);
    await create(alice, {
      title: 'x',
      mode: 'scheduled',
      scheduledAt: new Date(Date.now() - 3600_000).toISOString(),
    }).expect(400);
    await create(alice, { title: '', mode: 'instant' }).expect(400);
  });

  it('chi tiết buổi họp trả về aiNotesVersion hiện tại', async () => {
    const res = await create(alice, {
      title: 'Có phiên bản',
      mode: 'scheduled',
      scheduledAt: inHours(3),
    }).expect(201);
    const before = await http().get(`/api/v1/meetings/${res.body.id}`).set(alice.auth).expect(200);
    expect(before.body.aiNotesVersion).toBe(0);
    await ctx.prisma.meeting.update({ where: { id: res.body.id }, data: { aiNotesVersion: 5 } });
    const after = await http().get(`/api/v1/meetings/${res.body.id}`).set(alice.auth).expect(200);
    expect(after.body.aiNotesVersion).toBe(5);
  });

  it('mời người ngoài workspace: tạo tài khoản như share, gửi thông báo meeting.invited, người được mời xem được buổi họp nhưng không thấy trong danh sách workspace', async () => {
    const res = await create(alice, {
      title: 'Có khách',
      mode: 'scheduled',
      scheduledAt: inHours(3),
      inviteeEmails: ['Guest@lunatech.vn', 'outsider@lunatech.vn'],
    }).expect(201);
    const id = res.body.id;

    const detail = await http().get(`/api/v1/meetings/${id}`).set(alice.auth).expect(200);
    expect(detail.body.invitees.map((u: { email: string }) => u.email).sort()).toEqual([
      'guest@lunatech.vn',
      'outsider@lunatech.vn',
    ]);
    expect(detail.body.canHost).toBe(true);

    const guest = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'guest@lunatech.vn' },
    });
    const [note] = await notificationsOf(outsider.userId, 'meeting.invited');
    expect(note?.payload).toMatchObject({
      meetingId: id,
      workspaceId: wsId,
      title: 'Có khách',
      byName: 'Alice',
    });
    expect(await notificationsOf(guest.id, 'meeting.invited')).toHaveLength(1);

    const asInvitee = await http().get(`/api/v1/meetings/${id}`).set(outsider.auth).expect(200);
    expect(asInvitee.body.canHost).toBe(false);
    const list = await http()
      .get(`/api/v1/workspaces/${wsId}/meetings`)
      .query({ scope: 'upcoming' })
      .set(outsider.auth);
    expect(list.status).toBe(404);

    await http()
      .post(`/api/v1/meetings/${id}/invites`)
      .set(alice.auth)
      .send({ emails: ['someone@gmail.com'] })
      .expect(400);

    const added = await http()
      .post(`/api/v1/meetings/${id}/invites`)
      .set(alice.auth)
      .send({ emails: ['late@lunatech.vn', 'guest@lunatech.vn'] })
      .expect(201);
    expect(added.body.added.map((u: { email: string }) => u.email)).toEqual(['late@lunatech.vn']);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.invite', targetId: id } }),
    ).toBe(1);

    await http().delete(`/api/v1/meetings/${id}/invites/${guest.id}`).set(bob.auth).expect(403);
    await http().delete(`/api/v1/meetings/${id}/invites/${guest.id}`).set(alice.auth).expect(204);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.uninvite', targetId: id } }),
    ).toBe(1);
    expect(await ctx.prisma.meetingInvite.count({ where: { meetingId: id } })).toBe(2);
  });

  it('xem buổi họp: thành viên mọi vai trò xem được; người ngoài và người bị khoá tài khoản 404', async () => {
    const res = await create(bob, { title: 'Xem', mode: 'instant' }).expect(201);
    const id = res.body.id;
    for (const as of [alice, bob, vera]) {
      const got = await http().get(`/api/v1/meetings/${id}`).set(as.auth).expect(200);
      expect(got.body).toMatchObject({ id, title: 'Xem', invitees: [], attendees: [] });
    }
    expect((await http().get(`/api/v1/meetings/${id}`).set(vera.auth)).body.canHost).toBe(false);
    await http().get(`/api/v1/meetings/${id}`).set(outsider.auth).expect(404);
    await http()
      .get('/api/v1/meetings/00000000-0000-7000-8000-000000000000')
      .set(alice.auth)
      .expect(404);

    await ctx.prisma.user.update({ where: { id: vera.userId }, data: { status: 'DISABLED' } });
    const blocked = await http().get(`/api/v1/meetings/${id}`).set(vera.auth);
    expect([401, 404]).toContain(blocked.status);
    await ctx.prisma.user.update({ where: { id: vera.userId }, data: { status: 'ACTIVE' } });
    vera = await loginAs(ctx, 'vera@lunatech.vn', { name: 'Vera' });
  });

  it('chỉ người tạo sửa, huỷ, mời; huỷ gửi meeting.cancelled; sửa buổi họp đã kết thúc → 409', async () => {
    const res = await create(bob, {
      title: 'Của Bob',
      mode: 'scheduled',
      scheduledAt: inHours(5),
      inviteeEmails: ['outsider@lunatech.vn'],
    }).expect(201);
    const id = res.body.id;

    for (const who of [vera, outsider]) {
      await http()
        .patch(`/api/v1/meetings/${id}`)
        .set(who.auth)
        .send({ title: 'Hack' })
        .expect(403);
      await http().post(`/api/v1/meetings/${id}/cancel`).set(who.auth).expect(403);
      await http()
        .post(`/api/v1/meetings/${id}/invites`)
        .set(who.auth)
        .send({ emails: ['x@lunatech.vn'] })
        .expect(403);
    }

    const next = inHours(6);
    const patched = await http()
      .patch(`/api/v1/meetings/${id}`)
      .set(bob.auth)
      .send({ title: 'Đổi tên', scheduledAt: next, aiNotesEnabled: false })
      .expect(200);
    expect(patched.body).toMatchObject({ title: 'Đổi tên', aiNotesEnabled: false });
    expect(new Date(patched.body.scheduledAt).toISOString()).toBe(next);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.update', targetId: id } }),
    ).toBe(1);

    await http().post(`/api/v1/meetings/${id}/cancel`).set(bob.auth).expect(204);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.cancel', targetId: id } }),
    ).toBe(1);
    const [note] = await notificationsOf(outsider.userId, 'meeting.cancelled');
    expect(note?.payload).toMatchObject({ meetingId: id, title: 'Đổi tên' });
    const after = await http().get(`/api/v1/meetings/${id}`).set(bob.auth).expect(200);
    expect(after.body.status).toBe('CANCELLED');

    const cancelled = await http().post(`/api/v1/meetings/${id}/cancel`).set(bob.auth).expect(409);
    expect(cancelled.body.error.message).toBe('This meeting has already ended');
    await http().patch(`/api/v1/meetings/${id}`).set(bob.auth).send({ title: 'z' }).expect(409);
    await http()
      .post(`/api/v1/meetings/${id}/invites`)
      .set(bob.auth)
      .send({ emails: ['x@lunatech.vn'] })
      .expect(409);

    const ended = await create(bob, { title: 'Đã xong', mode: 'instant' }).expect(201);
    await ctx.prisma.meeting.update({
      where: { id: ended.body.id },
      data: { status: 'ENDED', startedAt: new Date(), endedAt: new Date() },
    });
    await http()
      .patch(`/api/v1/meetings/${ended.body.id}`)
      .set(bob.auth)
      .send({ title: 'z' })
      .expect(409);
  });

  it('danh sách theo scope: upcoming theo scheduledAt tăng dần, past theo endedAt giảm dần, phân trang cursor', async () => {
    const ws = (
      await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({ name: 'Lists', slug: 'lists', kind: 'TEAM' })
        .expect(201)
    ).body.id;
    const mk = async (title: string, h: number) =>
      (await create(alice, { title, mode: 'scheduled', scheduledAt: inHours(h) }, ws).expect(201))
        .body.id as string;
    const late = await mk('late', 30);
    const soon = await mk('soon', 10);
    const mid = await mk('mid', 20);
    const live = await mk('live', 1);
    const p1 = await mk('p1', 2);
    const p2 = await mk('p2', 3);
    const p3 = await mk('p3', 4);
    const cancelled = await mk('cancelled', 5);
    await http().post(`/api/v1/meetings/${cancelled}/cancel`).set(alice.auth).expect(204);
    const now = Date.now();
    await ctx.prisma.meeting.update({
      where: { id: live },
      data: { status: 'LIVE', startedAt: new Date(now) },
    });
    for (const [id, minutesAgo] of [
      [p1, 30],
      [p2, 10],
      [p3, 20],
    ] as const) {
      await ctx.prisma.meeting.update({
        where: { id },
        data: {
          status: 'ENDED',
          startedAt: new Date(now - 3600_000),
          endedAt: new Date(now - minutesAgo * 60_000),
        },
      });
    }
    await ctx.prisma.meetingMinutes.createMany({
      data: [
        { meetingId: p2, status: 'AWAITING_REVIEW' },
        { meetingId: p3, status: 'FAILED' },
      ],
    });
    const list = (scope: string, extra: Record<string, unknown> = {}) =>
      http()
        .get(`/api/v1/workspaces/${ws}/meetings`)
        .query({ scope, ...extra })
        .set(bob.auth);
    await ctx.prisma.workspaceMember.create({
      data: { workspaceId: ws, userId: bob.userId, role: 'MEMBER' },
    });

    const upcoming = await list('upcoming').expect(200);
    expect(upcoming.body.items.map((m: { id: string }) => m.id)).toEqual([soon, mid, late]);
    expect(upcoming.body.nextCursor).toBeNull();

    const liveList = await list('live').expect(200);
    expect(liveList.body.items.map((m: { id: string }) => m.id)).toEqual([live]);

    const first = await list('past', { limit: 2 }).expect(200);
    expect(first.body.items.map((m: { id: string }) => m.id)).toEqual([p2, p3]);
    expect(first.body.nextCursor).toBeTruthy();
    expect(first.body.items.map((m: { minutes: unknown }) => m.minutes)).toEqual([
      { status: 'AWAITING_REVIEW' },
      { status: 'FAILED' },
    ]);
    const second = await list('past', { limit: 2, cursor: first.body.nextCursor }).expect(200);
    expect(second.body.items.map((m: { id: string }) => m.id)).toEqual([p1]);
    expect(second.body.items[0].minutes).toEqual({ status: 'NONE' });
    expect(upcoming.body.items[0].minutes).toEqual({ status: 'NONE' });
    expect(second.body.nextCursor).toBeNull();

    await list('nonsense').expect(400);
    await http()
      .get(`/api/v1/workspaces/${ws}/meetings`)
      .query({ scope: 'past' })
      .set(outsider.auth)
      .expect(404);
  });

  it('quản trị workspace quản lý được buổi họp của người khác; không phải người tạo thì không thành host', async () => {
    const res = await create(bob, {
      title: 'Admin huỷ',
      mode: 'scheduled',
      scheduledAt: inHours(4),
      inviteeEmails: ['outsider@lunatech.vn'],
    }).expect(201);
    const id = res.body.id;
    const asAdmin = await http().get(`/api/v1/meetings/${id}`).set(alice.auth).expect(200);
    expect(asAdmin.body).toMatchObject({ canHost: false, canManage: true });
    await http().patch(`/api/v1/meetings/${id}`).set(alice.auth).send({ title: 'Đổi' }).expect(200);
    await http()
      .post(`/api/v1/meetings/${id}/invites`)
      .set(alice.auth)
      .send({ emails: ['late2@lunatech.vn'] })
      .expect(201);
    await http().post(`/api/v1/meetings/${id}/cancel`).set(alice.auth).expect(204);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'meeting.cancel', targetId: id },
    });
    expect(audit?.actorId).toBe(alice.userId);
  });

  it('gỡ lời mời người chưa được mời → 404; mời vào buổi họp đã kết thúc hoặc đã huỷ → 409', async () => {
    const res = await create(alice, { title: 'Mời', mode: 'instant' }).expect(201);
    const id = res.body.id;
    await http().delete(`/api/v1/meetings/${id}/invites/${bob.userId}`).set(alice.auth).expect(404);
    await ctx.prisma.meeting.update({
      where: { id },
      data: { status: 'ENDED', startedAt: new Date(), endedAt: new Date() },
    });
    await http()
      .post(`/api/v1/meetings/${id}/invites`)
      .set(alice.auth)
      .send({ emails: ['x@lunatech.vn'] })
      .expect(409);
  });

  it('bỏ lời mời của buổi họp đã kết thúc hoặc đã huỷ → 409, còn buổi họp chưa bắt đầu thì gỡ được', async () => {
    const res = await create(alice, {
      title: 'Gỡ',
      mode: 'scheduled',
      scheduledAt: inHours(3),
      inviteeEmails: ['outsider@lunatech.vn'],
    }).expect(201);
    const id = res.body.id;
    const uninvite = () =>
      http().delete(`/api/v1/meetings/${id}/invites/${outsider.userId}`).set(alice.auth);
    await http().post(`/api/v1/meetings/${id}/cancel`).set(alice.auth).expect(204);
    const cancelled = await uninvite().expect(409);
    expect(cancelled.body.error.message).toBe('This meeting has already ended');
    await ctx.prisma.meeting.update({
      where: { id },
      data: { status: 'ENDED', startedAt: new Date(), endedAt: new Date() },
    });
    await uninvite().expect(409);
    expect(await ctx.prisma.meetingInvite.count({ where: { meetingId: id } })).toBe(1);

    const open = await create(alice, {
      title: 'Gỡ được',
      mode: 'scheduled',
      scheduledAt: inHours(3),
      inviteeEmails: ['outsider@lunatech.vn'],
    }).expect(201);
    await http()
      .delete(`/api/v1/meetings/${open.body.id}/invites/${outsider.userId}`)
      .set(alice.auth)
      .expect(204);
  });

  it('huỷ gửi thông báo cho cùng nhóm người nhận như nhắc: người tạo, người được mời, thành viên TEAM đang hoạt động, trừ người huỷ', async () => {
    const disabled = await ctx.prisma.user.create({
      data: { email: 'disabled@lunatech.vn', name: 'Disabled', status: 'DISABLED' },
    });
    await ctx.prisma.workspaceMember.create({
      data: { workspaceId: wsId, userId: disabled.id, role: 'MEMBER' },
    });
    const res = await create(bob, {
      title: 'Huỷ cả nhóm',
      mode: 'scheduled',
      scheduledAt: inHours(4),
      inviteeEmails: ['outsider@lunatech.vn'],
    }).expect(201);
    const id = res.body.id;
    await http().post(`/api/v1/meetings/${id}/cancel`).set(alice.auth).expect(204);
    const notes = await ctx.prisma.notification.findMany({
      where: { type: 'meeting.cancelled', payload: { path: ['meetingId'], equals: id } },
    });
    expect(notes.map((n) => n.userId).sort()).toEqual(
      [bob.userId, vera.userId, outsider.userId].sort(),
    );
    expect(notes[0]?.payload).toMatchObject({ byName: 'Alice', title: 'Huỷ cả nhóm' });
  });

  it('mời đồng thời cùng một người chỉ thông báo và ghi audit một lần', async () => {
    const res = await create(alice, { title: 'Song song', mode: 'instant' }).expect(201);
    const id = res.body.id;
    await ctx.prisma.user.create({ data: { email: 'racer@lunatech.vn', name: 'Racer' } });
    await Promise.all(
      [1, 2, 3].map(() =>
        http()
          .post(`/api/v1/meetings/${id}/invites`)
          .set(alice.auth)
          .send({ emails: ['racer@lunatech.vn'] })
          .expect(201),
      ),
    );
    const racer = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'racer@lunatech.vn' },
    });
    expect(await notificationsOf(racer.id, 'meeting.invited')).toHaveLength(1);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.invite', targetId: id } }),
    ).toBe(1);
  });

  it('đặt lịch và đổi giờ xếp job nhắc theo giờ họp; họp ngay không có job nhắc', async () => {
    const queue = new Queue(QUEUES.MEETINGS, {
      connection: redisConnection(process.env.REDIS_URL!),
      prefix: 'luna',
    });
    try {
      const at = inHours(3);
      const made = await create(alice, { title: 'Nhắc lịch', mode: 'scheduled', scheduledAt: at });
      const id = made.body.id as string;
      const first = await queue.getJob(`remind-${id}-${new Date(at).getTime()}`);
      expect(first?.data).toEqual({ meetingId: id, scheduledAt: new Date(at).toISOString() });
      expect(first?.opts.delay).toBeGreaterThan(0);

      const next = inHours(6);
      await http()
        .patch(`/api/v1/meetings/${id}`)
        .set(alice.auth)
        .send({ scheduledAt: next })
        .expect(200);
      const moved = await queue.getJob(`remind-${id}-${new Date(next).getTime()}`);
      expect(moved?.data).toEqual({ meetingId: id, scheduledAt: new Date(next).toISOString() });

      const instant = await create(alice, { title: 'Ngay', mode: 'instant' }).expect(201);
      const jobs = await queue.getDelayed();
      expect(jobs.some((j) => j.data.meetingId === instant.body.id)).toBe(false);
    } finally {
      await queue.close();
    }
  });
});
