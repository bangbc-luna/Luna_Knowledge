import { QUEUES } from '@luna/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { vi } from 'vitest';
import { MinutesService } from '../src/meetings/minutes/minutes.service.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

const text = (value: string) => ({ type: 'text', text: value });
const para = (...content: object[]) => ({ type: 'paragraph', content });
const cell = (type: string, ...content: object[]) => ({ type, content: [para(...content)] });
const mention = (id: string, label: string, suggested: boolean) => ({
  type: 'mention',
  attrs: { id, label, suggested },
});

function minutesDoc(rows: Array<{ task: string; owner: object }>) {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('Biên bản')] },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: ['#', 'Việc', 'Người phụ trách'].map((h) => cell('tableHeader', text(h))),
          },
          ...rows.map((r, i) => ({
            type: 'tableRow',
            content: [
              cell('tableCell', text(String(i + 1))),
              cell('tableCell', text(r.task)),
              cell('tableCell', r.owner),
            ],
          })),
        ],
      },
    ],
  };
}

describe('Meeting minutes (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let carol: LoggedIn;
  let dave: LoggedIn;
  let guest: LoggedIn;
  let stranger: LoggedIn;
  let wsId: string;
  let recorderQueue: Queue;
  let minutesQueue: Queue;
  const http = () => request(ctx.app.getHttpServer());
  const create = async (as: LoggedIn, body: Record<string, unknown> = {}) => {
    const res = await http()
      .post(`/api/v1/workspaces/${wsId}/meetings`)
      .set(as.auth)
      .send({ title: 'Họp sprint', mode: 'instant', ...body })
      .expect(201);
    return res.body.id as string;
  };
  const minutesUrl = (id: string, tail = '') => `/api/v1/meetings/${id}/minutes${tail}`;

  async function seed(
    opts: {
      status?: 'AWAITING_REVIEW' | 'FAILED' | 'PROCESSING';
      doc?: object;
      suggestions?: object[];
      failedStage?: string;
      audioPurgedAt?: Date;
      error?: string;
      title?: string;
    } = {},
  ) {
    const id = await create(alice, {
      title: opts.title ?? 'Họp sprint',
      inviteeEmails: ['guest@lunatech.vn'],
    });
    const startedAt = new Date('2026-11-03T02:00:00.000Z');
    await ctx.prisma.meeting.update({
      where: { id },
      data: { status: 'ENDED', startedAt, endedAt: new Date(), endReason: 'host' },
    });
    await ctx.prisma.meetingAttendance.create({
      data: { meetingId: id, userId: carol.userId, joinedAt: startedAt, leftAt: new Date() },
    });
    await ctx.prisma.meetingMinutes.create({
      data: {
        meetingId: id,
        status: opts.status ?? 'AWAITING_REVIEW',
        draftDoc: (opts.doc ??
          minutesDoc([{ task: 'Gửi báo giá', owner: text('Ai đó') }])) as object,
        draftRevision: 1,
        suggestions: (opts.suggestions ?? []) as object[],
        failedStage: opts.failedStage ?? null,
        audioPurgedAt: opts.audioPurgedAt ?? null,
        error: opts.error ?? null,
      },
    });
    return id;
  }

  const notificationTypes = async (userId: string) =>
    (await ctx.prisma.notification.findMany({ where: { userId } })).map((n) => n.type).sort();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    carol = await loginAs(ctx, 'carol@lunatech.vn', { name: 'Carol' });
    dave = await loginAs(ctx, 'dave@lunatech.vn', { name: 'Dave' });
    guest = await loginAs(ctx, 'guest@lunatech.vn', { name: 'Guest' });
    stranger = await loginAs(ctx, 'stranger@lunatech.vn', { name: 'Stranger' });
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .send({ name: 'Minutes', slug: 'minutes', kind: 'TEAM' })
      .expect(201);
    wsId = ws.body.id;
    await ctx.prisma.workspaceMember.createMany({
      data: [
        { workspaceId: wsId, userId: bob.userId, role: 'MEMBER' },
        { workspaceId: wsId, userId: carol.userId, role: 'MEMBER' },
        { workspaceId: wsId, userId: dave.userId, role: 'ADMIN' },
      ],
    });
    recorderQueue = ctx.app.get(getQueueToken(QUEUES.MEETING_RECORDER));
    minutesQueue = ctx.app.get(getQueueToken(QUEUES.MEETING_MINUTES));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('vào phòng khi bật ghi biên bản → có job record; tắt ghi trước khi bắt đầu → không có job', async () => {
    const on = await create(alice, { aiNotesEnabled: true });
    await http().post(`/api/v1/meetings/${on}/join`).set(alice.auth).expect(200);
    expect(await recorderQueue.getJob(`record-${on}`)).toBeTruthy();

    const off = await create(alice, { aiNotesEnabled: false });
    await http().post(`/api/v1/meetings/${off}/join`).set(alice.auth).expect(200);
    expect(await recorderQueue.getJob(`record-${off}`)).toBeFalsy();

    await http()
      .put(`/api/v1/meetings/${off}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: true })
      .expect(200);
    expect(await recorderQueue.getJob(`record-${off}`)).toBeTruthy();

    const scheduled = await create(alice, {
      aiNotesEnabled: false,
      mode: 'scheduled',
      scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    });
    await http()
      .put(`/api/v1/meetings/${scheduled}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: true })
      .expect(200);
    expect(await recorderQueue.getJob(`record-${scheduled}`)).toBeFalsy();
  });

  it('kết thúc buổi họp có biên bản → hook thật xếp job xử lý; không có biên bản thì không xếp', async () => {
    const withRow = await create(alice);
    await http().post(`/api/v1/meetings/${withRow}/join`).set(alice.auth).expect(200);
    await ctx.prisma.meetingMinutes.create({ data: { meetingId: withRow } });
    await http().post(`/api/v1/meetings/${withRow}/end`).set(alice.auth).expect(204);
    expect(await minutesQueue.getJob(`minutes-${withRow}`)).toBeTruthy();

    const without = await create(alice, { aiNotesEnabled: false });
    await http().post(`/api/v1/meetings/${without}/join`).set(alice.auth).expect(200);
    await http().post(`/api/v1/meetings/${without}/end`).set(alice.auth).expect(204);
    expect(await minutesQueue.getJob(`minutes-${without}`)).toBeFalsy();
  });

  it('bản nháp chỉ người tạo và quản trị workspace xem được; thành viên khác chỉ thấy trạng thái; người ngoài 404', async () => {
    const id = await seed({
      error: 'Cảnh báo: bản ghi quá dài',
      suggestions: [{ actionIndex: 0, name: 'Hùng', userId: bob.userId, userName: 'Bob' }],
    });
    for (const as of [alice, dave]) {
      const res = await http().get(minutesUrl(id)).set(as.auth).expect(200);
      expect(res.body.canReview).toBe(true);
      expect(res.body.status).toBe('AWAITING_REVIEW');
      expect(res.body.draft.revision).toBe(1);
      expect(res.body.draft.suggestions).toHaveLength(1);
      expect(res.body.warning).toBe('Cảnh báo: bản ghi quá dài');
      expect(res.body.error).toBeNull();
    }
    for (const as of [bob, carol, guest]) {
      const res = await http().get(minutesUrl(id)).set(as.auth).expect(200);
      expect(res.body).toMatchObject({
        status: 'AWAITING_REVIEW',
        canReview: false,
        draft: null,
        warning: null,
        error: null,
        documentNodeId: null,
      });
    }
    await http().get(minutesUrl(id)).set(stranger.auth).expect(404);
    await http()
      .put(minutesUrl(id, '/draft'))
      .set(bob.auth)
      .send({ doc: minutesDoc([]), revision: 1 })
      .expect(403);
    await http()
      .post(minutesUrl(id, '/publish'))
      .set(bob.auth)
      .send({ revision: 1, confirmedUserIds: [] })
      .expect(403);
    const detail = await http().get(`/api/v1/meetings/${id}`).set(bob.auth).expect(200);
    expect(detail.body.minutes).toEqual({ status: 'AWAITING_REVIEW', documentNodeId: null });

    const none = await create(alice);
    const res = await http().get(minutesUrl(none)).set(alice.auth).expect(200);
    expect(res.body.status).toBe('NONE');
  });

  it('lưu nháp: revision lệch → 409; nội dung sai schema editor → 400', async () => {
    const id = await seed();
    const doc = minutesDoc([{ task: 'Việc mới', owner: text('Ai đó') }]);
    const saved = await http()
      .put(minutesUrl(id, '/draft'))
      .set(alice.auth)
      .send({ doc, revision: 1 })
      .expect(200);
    expect(saved.body).toEqual({ revision: 2 });
    const stale = await http()
      .put(minutesUrl(id, '/draft'))
      .set(dave.auth)
      .send({ doc, revision: 1 })
      .expect(409);
    expect(stale.body.error.message).toBe(
      'Someone else saved these minutes, reload to see their changes',
    );
    await http()
      .put(minutesUrl(id, '/draft'))
      .set(alice.auth)
      .send({ doc: { type: 'doc', content: [{ type: 'nonsense' }] }, revision: 2 })
      .expect(400);
    const row = await ctx.prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: id } });
    expect(row.draftRevision).toBe(2);

    const failed = await seed({ status: 'FAILED', failedStage: 'draft' });
    const res = await http()
      .put(minutesUrl(failed, '/draft'))
      .set(alice.auth)
      .send({ doc, revision: 1 })
      .expect(409);
    expect(res.body.error.message).toBe('These minutes are not waiting for review');
  });

  it('gửi biên bản: tạo thư mục "Biên bản họp" một lần, tài liệu có mention, share chỉ xem cho người được mời ngoài workspace, audit meeting.minutes_publish', async () => {
    const doc = minutesDoc([{ task: 'Gửi báo giá', owner: mention(carol.userId, 'Carol', false) }]);
    const first = await seed({ doc, title: 'Họp A/B' });
    const second = await seed({ doc, title: 'Họp C' });
    const r1 = await http()
      .post(minutesUrl(first, '/publish'))
      .set(alice.auth)
      .send({ revision: 1, confirmedUserIds: [] })
      .expect(200);
    await http()
      .post(minutesUrl(second, '/publish'))
      .set(dave.auth)
      .send({ revision: 1, confirmedUserIds: [] })
      .expect(200);

    const folders = await ctx.prisma.node.findMany({
      where: { workspaceId: wsId, type: 'FOLDER', name: 'Biên bản họp', parentId: null },
    });
    expect(folders).toHaveLength(1);
    const node = await ctx.prisma.node.findUniqueOrThrow({
      where: { id: r1.body.documentNodeId },
      include: { document: true },
    });
    expect(node.parentId).toBe(folders[0]!.id);
    expect(node.name).toBe('Biên bản: Họp A B · 03/11/2026');
    expect(JSON.stringify(node.document?.contentJson)).toContain(carol.userId);

    const shares = await ctx.prisma.nodeShare.findMany({ where: { nodeId: node.id } });
    expect(shares.map((s) => [s.userId, s.role])).toEqual([[guest.userId, 'VIEWER']]);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'meeting.minutes_publish', targetId: node.id },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          action: 'share.add',
          targetId: node.id,
          metadata: { path: ['via'], equals: 'meeting' },
        },
      }),
    ).toBe(1);

    const row = await ctx.prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: first } });
    expect(row).toMatchObject({
      status: 'PUBLISHED',
      documentNodeId: node.id,
      publishedById: alice.userId,
    });
    const view = await http().get(minutesUrl(first)).set(guest.auth).expect(200);
    expect(view.body.documentNodeId).toBe(node.id);
    await http().get(`/api/v1/documents/${node.id}`).set(guest.auth).expect(200);
  });

  it('gửi hai lần đồng thời → một tài liệu, lần sau 409', async () => {
    const id = await seed({ title: 'Họp song song' });
    const before = await ctx.prisma.node.count({ where: { type: 'DOCUMENT' } });
    const results = await Promise.all([
      http().post(minutesUrl(id, '/publish')).set(alice.auth).send({ revision: 1 }),
      http().post(minutesUrl(id, '/publish')).set(dave.auth).send({ revision: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await ctx.prisma.node.count({ where: { type: 'DOCUMENT' } })).toBe(before + 1);
    await http().post(minutesUrl(id, '/publish')).set(alice.auth).send({ revision: 1 }).expect(409);
    await http().post(minutesUrl(id, '/publish')).set(alice.auth).send({ revision: 7 }).expect(409);
  });

  it('gợi ý không được xác nhận thành chữ thường và không nhận thông báo; được xác nhận thì nhận meeting.minutes_assigned', async () => {
    const doc = minutesDoc([
      { task: 'Chốt hợp đồng', owner: mention(bob.userId, 'Hùng', true) },
      { task: 'Gửi báo giá', owner: mention(dave.userId, 'Dũng', true) },
    ]);
    const suggestions = [
      { actionIndex: 0, name: 'Hùng', userId: bob.userId, userName: 'Bob' },
      { actionIndex: 1, name: 'Dũng', userId: dave.userId, userName: 'Dave' },
    ];
    const id = await seed({ doc, suggestions });
    const bobBefore = (await notificationTypes(bob.userId)).length;
    const res = await http()
      .post(minutesUrl(id, '/publish'))
      .set(alice.auth)
      .send({ revision: 1, confirmedUserIds: [dave.userId, stranger.userId] })
      .expect(200);
    const node = await ctx.prisma.node.findUniqueOrThrow({
      where: { id: res.body.documentNodeId },
      include: { document: true },
    });
    const json = JSON.stringify(node.document?.contentJson);
    expect(json).toContain(dave.userId);
    expect(json).not.toContain(bob.userId);
    expect(json).toContain('Hùng');
    expect((await notificationTypes(bob.userId)).length).toBe(bobBefore);
    const assigned = await ctx.prisma.notification.findFirstOrThrow({
      where: { userId: dave.userId, type: 'meeting.minutes_assigned' },
    });
    expect(assigned.payload).toMatchObject({
      meetingId: id,
      nodeId: node.id,
      tasks: ['Gửi báo giá'],
    });
    expect(await notificationTypes(dave.userId)).toContain('meeting.minutes_published');
    expect(
      await ctx.prisma.notification.count({
        where: {
          userId: alice.userId,
          type: 'meeting.minutes_published',
          payload: { path: ['meetingId'], equals: id },
        },
      }),
    ).toBe(0);
    const carolTypes = await ctx.prisma.notification.count({
      where: {
        userId: carol.userId,
        type: 'meeting.minutes_published',
        payload: { path: ['meetingId'], equals: id },
      },
    });
    expect(carolTypes).toBe(1);
  });

  it('người được gắn nhưng không xem được tài liệu không nhận thông báo', async () => {
    const doc = minutesDoc([
      { task: 'Việc ngoài', owner: mention(stranger.userId, 'Stranger', false) },
    ]);
    const id = await seed({ doc });
    await http().post(minutesUrl(id, '/publish')).set(alice.auth).send({ revision: 1 }).expect(200);
    expect(await notificationTypes(stranger.userId)).toEqual([]);
  });

  it('tạo tài liệu lỗi giữa chừng → biên bản quay về chờ duyệt, không có tài liệu mồ côi', async () => {
    const id = await seed({ title: 'Họp lỗi' });
    const service = ctx.app.get(MinutesService) as unknown as {
      finalize: (...args: unknown[]) => Promise<void>;
    };
    const spy = vi.spyOn(service, 'finalize').mockRejectedValueOnce(new Error('boom'));
    try {
      await http()
        .post(minutesUrl(id, '/publish'))
        .set(alice.auth)
        .send({ revision: 1 })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const row = await ctx.prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: id } });
    expect(row.status).toBe('AWAITING_REVIEW');
    expect(row.documentNodeId).toBeNull();
    expect(
      await ctx.prisma.node.count({ where: { type: 'DOCUMENT', name: { contains: 'Họp lỗi' } } }),
    ).toBe(0);
    await http().post(minutesUrl(id, '/publish')).set(alice.auth).send({ revision: 1 }).expect(200);
  });

  it('thử lại khi lỗi ở bước draft → job mới với jobId khác; âm thanh đã hết hạn ở bước transcribe → 409', async () => {
    const id = await seed({ status: 'FAILED', failedStage: 'draft', error: 'LLM down' });
    const view = await http().get(minutesUrl(id)).set(alice.auth).expect(200);
    expect(view.body).toMatchObject({ status: 'FAILED', error: 'LLM down', warning: null });
    await http().post(minutesUrl(id, '/retry')).set(bob.auth).expect(403);
    const first = await http().post(minutesUrl(id, '/retry')).set(alice.auth).expect(202);
    expect(first.body).toEqual({ attempt: 1 });
    expect(await minutesQueue.getJob(`minutes-${id}-retry-1`)).toBeTruthy();
    const second = await http().post(minutesUrl(id, '/retry')).set(dave.auth).expect(202);
    expect(second.body).toEqual({ attempt: 2 });
    expect(await minutesQueue.getJob(`minutes-${id}-retry-2`)).toBeTruthy();
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.minutes_retry', targetId: id } }),
    ).toBe(2);

    const expired = await seed({
      status: 'FAILED',
      failedStage: 'transcribe',
      audioPurgedAt: new Date(),
    });
    const res = await http().post(minutesUrl(expired, '/retry')).set(alice.auth).expect(409);
    expect(res.body.error.message).toBe('The audio for this meeting has expired');

    const waiting = await seed();
    await http().post(minutesUrl(waiting, '/retry')).set(alice.auth).expect(409);
  });
});
