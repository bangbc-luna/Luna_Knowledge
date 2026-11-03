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
  const reviewers: LoggedIn[] = [];
  let turn = 0;
  const reviewer = () => reviewers[turn++ % reviewers.length]!;
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
    for (const n of [1, 2, 3, 4, 5]) {
      reviewers.push(await loginAs(ctx, `ops${n}@lunatech.vn`, { name: `Ops ${n}` }));
    }
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
        ...reviewers.map((r) => ({ workspaceId: wsId, userId: r.userId, role: 'ADMIN' as const })),
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
      http().post(minutesUrl(id, '/publish')).set(reviewer().auth).send({ revision: 1 }),
      http().post(minutesUrl(id, '/publish')).set(dave.auth).send({ revision: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await ctx.prisma.node.count({ where: { type: 'DOCUMENT' } })).toBe(before + 1);
    await http()
      .post(minutesUrl(id, '/publish'))
      .set(reviewer().auth)
      .send({ revision: 1 })
      .expect(409);
    await http()
      .post(minutesUrl(id, '/publish'))
      .set(reviewer().auth)
      .send({ revision: 7 })
      .expect(409);
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
    expect(json).toContain('Bob');
    expect(json).not.toContain('Hùng');
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
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'meeting.minutes_publish', metadata: { path: ['meetingId'], equals: id } },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.nodeShare.count({ where: { node: { name: { contains: 'Họp lỗi' } } } }),
    ).toBe(0);
    await http().post(minutesUrl(id, '/publish')).set(alice.auth).send({ revision: 1 }).expect(200);
  });

  it('thử lại khi lỗi ở bước draft → job mới với jobId khác; âm thanh đã hết hạn ở bước transcribe → 409', async () => {
    const id = await seed({ status: 'FAILED', failedStage: 'draft', error: 'LLM down' });
    const view = await http().get(minutesUrl(id)).set(alice.auth).expect(200);
    expect(view.body).toMatchObject({ status: 'FAILED', error: 'LLM down', warning: null });
    await http().post(minutesUrl(id, '/retry')).set(bob.auth).expect(403);
    const first = await http().post(minutesUrl(id, '/retry')).set(reviewer().auth).expect(202);
    expect(first.body).toEqual({ attempt: 1 });
    expect(await minutesQueue.getJob(`minutes-${id}-retry-1`)).toBeTruthy();
    await ctx.prisma.meetingMinutes.update({
      where: { meetingId: id },
      data: { status: 'FAILED' },
    });
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
    const res = await http().post(minutesUrl(expired, '/retry')).set(reviewer().auth).expect(409);
    expect(res.body.error.message).toBe('The audio for this meeting has expired');

    const waiting = await seed();
    await http().post(minutesUrl(waiting, '/retry')).set(reviewer().auth).expect(409);
  });

  it('lỗi: failureReason ngắn bằng tiếng Việt theo bước, canRetry theo khả năng chạy lại; lỗi gốc chỉ người duyệt thấy', async () => {
    const draftFail = await seed({ status: 'FAILED', failedStage: 'draft', error: 'LLM 500 raw' });
    const asReviewer = await http().get(minutesUrl(draftFail)).set(alice.auth).expect(200);
    expect(asReviewer.body).toMatchObject({
      error: 'LLM 500 raw',
      canRetry: true,
      failureReason: 'Không soạn được biên bản từ nội dung đã chép lời.',
    });
    const asMember = await http().get(minutesUrl(draftFail)).set(bob.auth).expect(200);
    expect(asMember.body).toMatchObject({
      error: null,
      canRetry: false,
      failureReason: 'Không soạn được biên bản từ nội dung đã chép lời.',
    });

    const pending = await seed({ status: 'FAILED', failedStage: 'transcribe', error: 'STT down' });
    await ctx.prisma.meetingAudioChunk.create({
      data: {
        meetingId: pending,
        userId: alice.userId,
        startOffsetMs: 0,
        durationMs: 1000,
        container: 'audio',
        key: `k/${pending}`,
        sizeBytes: 1n,
      },
    });
    const pendingView = await http().get(minutesUrl(pending)).set(alice.auth).expect(200);
    expect(pendingView.body).toMatchObject({
      canRetry: true,
      failureReason: 'Không chép lời được âm thanh của buổi họp.',
    });

    const purged = await seed({
      status: 'FAILED',
      failedStage: 'transcribe',
      audioPurgedAt: new Date(),
    });
    const purgedView = await http().get(minutesUrl(purged)).set(alice.auth).expect(200);
    expect(purgedView.body.canRetry).toBe(false);
    expect(purgedView.body.failureReason).toBe(
      'Không chép lời được và âm thanh đã bị xoá nên không thể thử lại.',
    );

    const skippedAll = await seed({ status: 'FAILED', failedStage: 'transcribe' });
    const skippedView = await http().get(minutesUrl(skippedAll)).set(alice.auth).expect(200);
    expect(skippedView.body.canRetry).toBe(false);
    expect(skippedView.body.failureReason).toBe(
      'Không đoạn âm thanh nào chép lời được, chạy lại cũng không đổi kết quả.',
    );

    const config = await seed({
      status: 'FAILED',
      failedStage: 'config',
      error: 'AI minutes are not configured',
    });
    const configView = await http().get(minutesUrl(config)).set(alice.auth).expect(200);
    expect(configView.body).toMatchObject({
      canRetry: false,
      failureReason: 'Máy chủ chưa cấu hình biên bản AI.',
    });
    await http().post(minutesUrl(config, '/retry')).set(reviewer().auth).expect(409);
    await http().post(minutesUrl(skippedAll, '/retry')).set(reviewer().auth).expect(409);

    const waiting = await http()
      .get(minutesUrl(await seed()))
      .set(alice.auth)
      .expect(200);
    expect(waiting.body).toMatchObject({ canRetry: false, failureReason: null });
    const none = await http()
      .get(minutesUrl(await create(alice, { aiNotesEnabled: false })))
      .set(alice.auth)
      .expect(200);
    expect(none.body).toMatchObject({ canRetry: false, failureReason: null });
  });

  it('publish và retry bị giới hạn khoảng 10 lần mỗi phút cho mỗi người', async () => {
    const spammer = await loginAs(ctx, 'spammer@lunatech.vn', { name: 'Spammer' });
    await ctx.prisma.workspaceMember.create({
      data: { workspaceId: wsId, userId: spammer.userId, role: 'ADMIN' },
    });
    const id = await seed();
    const statuses = async (path: string, body?: object) => {
      const out: number[] = [];
      for (let i = 0; i < 11; i++) {
        const req = http().post(minutesUrl(id, path)).set(spammer.auth);
        out.push((await (body ? req.send(body) : req)).status);
      }
      return out;
    };
    const publish = await statuses('/publish', { revision: 99 });
    expect(publish.slice(0, 10).every((code) => code === 409)).toBe(true);
    expect(publish[10]).toBe(429);
    const retry = await statuses('/retry');
    expect(retry.slice(0, 10).every((code) => code === 409)).toBe(true);
    expect(retry[10]).toBe(429);
  });

  const bigDoc = (chars: number) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [text('a'.repeat(chars))] }],
  });

  it('bản nháp gần mức trần lưu được; vượt trần thì bị từ chối; route JSON khác vẫn giới hạn 512kb', async () => {
    const id = await seed();
    const saved = await http()
      .put(minutesUrl(id, '/draft'))
      .set(alice.auth)
      .send({ doc: bigDoc(1_900_000), revision: 1 })
      .expect(200);
    expect(saved.body).toEqual({ revision: 2 });
    const over = await http()
      .put(minutesUrl(id, '/draft'))
      .set(alice.auth)
      .send({ doc: bigDoc(2_200_000), revision: 2 });
    expect([400, 413]).toContain(over.status);
    await http()
      .put(minutesUrl(id, '/draft'))
      .set(alice.auth)
      .send({ doc: bigDoc(3_000_000), revision: 2 })
      .expect(413);
    await http()
      .post(`/api/v1/workspaces/${wsId}/meetings`)
      .set(alice.auth)
      .send({ title: 'x'.repeat(600_000), mode: 'instant' })
      .expect(413);
  });

  it('mention chèn bừa (người lạ, id không phải uuid, nhãn giả) bị đổi thành chữ lúc lưu và lúc gửi, không ai bị báo', async () => {
    const id = await seed();
    const injected = minutesDoc([
      { task: 'Việc A', owner: mention(stranger.userId, 'Stranger', false) },
      { task: 'Việc B', owner: mention('not-a-uuid', 'Ma', false) },
      { task: 'Việc C', owner: mention(carol.userId, 'Giả mạo', false) },
    ]);
    await http()
      .put(minutesUrl(id, '/draft'))
      .set(alice.auth)
      .send({ doc: injected, revision: 1 })
      .expect(200);
    const view = await http().get(minutesUrl(id)).set(alice.auth).expect(200);
    const saved = JSON.stringify(view.body.draft.doc);
    expect(saved).not.toContain(stranger.userId);
    expect(saved).not.toContain('not-a-uuid');
    expect(saved).toContain(carol.userId);
    expect(saved).not.toContain('Giả mạo');

    const direct = await seed();
    await ctx.prisma.meetingMinutes.update({
      where: { meetingId: direct },
      data: { draftDoc: injected as object },
    });
    const res = await http()
      .post(minutesUrl(direct, '/publish'))
      .set(reviewer().auth)
      .send({ revision: 1 })
      .expect(200);
    const node = await ctx.prisma.node.findUniqueOrThrow({
      where: { id: res.body.documentNodeId },
      include: { document: true },
    });
    const json = JSON.stringify(node.document?.contentJson);
    expect(json).not.toContain(stranger.userId);
    expect(json).not.toContain('not-a-uuid');
    expect(json).toContain('Stranger');
    expect(await notificationTypes(stranger.userId)).toEqual([]);
    expect(
      await ctx.prisma.notification.count({
        where: {
          userId: carol.userId,
          type: 'meeting.minutes_published',
          payload: { path: ['meetingId'], equals: direct },
        },
      }),
    ).toBe(1);
  });

  it('mention gợi ý (suggested) bị gắn nhãn giả → nhãn được đặt lại thành tên thật', async () => {
    const id = await seed({
      suggestions: [{ actionIndex: 0, name: 'Hùng', userId: bob.userId, userName: 'Bob' }],
    });
    await http()
      .put(minutesUrl(id, '/draft'))
      .set(alice.auth)
      .send({
        doc: minutesDoc([{ task: 'Việc A', owner: mention(bob.userId, 'CEO Giả mạo', true) }]),
        revision: 1,
      })
      .expect(200);
    const view = await http().get(minutesUrl(id)).set(alice.auth).expect(200);
    const saved = JSON.stringify(view.body.draft.doc);
    expect(saved).not.toContain('CEO Giả mạo');
    expect(saved).toContain('"label":"Bob"');
    expect(saved).toContain('"suggested":true');
  });

  it('thử lại đồng thời → một 202 và một 409; trạng thái chuyển sang PROCESSING', async () => {
    const id = await seed({ status: 'FAILED', failedStage: 'draft' });
    const results = await Promise.all([
      http().post(minutesUrl(id, '/retry')).set(reviewer().auth),
      http().post(minutesUrl(id, '/retry')).set(dave.auth),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
    const row = await ctx.prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: id } });
    expect(row.status).toBe('PROCESSING');
    expect(row.claimedBy).toBeNull();
  });

  it('thử lại mà xếp job lỗi → trả 503 và biên bản về lại FAILED', async () => {
    const id = await seed({ status: 'FAILED', failedStage: 'draft' });
    const spy = vi.spyOn(minutesQueue, 'add').mockRejectedValueOnce(new Error('redis down'));
    try {
      await http().post(minutesUrl(id, '/retry')).set(reviewer().auth).expect(503);
    } finally {
      spy.mockRestore();
    }
    const row = await ctx.prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: id } });
    expect(row.status).toBe('FAILED');
  });

  it('PUBLISHING bị kẹt quá 5 phút thì chiếm lại được và dọn tài liệu mồ côi; chưa quá hạn thì 409', async () => {
    const id = await seed({ title: 'Họp kẹt' });
    const orphan = await ctx.prisma.node.create({
      data: {
        workspaceId: wsId,
        type: 'DOCUMENT',
        section: 'DOCS',
        name: 'orphan',
        nameNormalized: 'orphan',
        createdById: alice.userId,
        updatedById: alice.userId,
      },
    });
    await ctx.prisma.meetingMinutes.update({
      where: { meetingId: id },
      data: { status: 'PUBLISHING', documentNodeId: orphan.id },
    });
    await http()
      .post(minutesUrl(id, '/publish'))
      .set(reviewer().auth)
      .send({ revision: 1 })
      .expect(409);
    await ctx.prisma
      .$executeRaw`UPDATE meeting_minutes SET updated_at = now() - interval '6 minutes' WHERE meeting_id = ${id}::uuid`;
    const res = await http()
      .post(minutesUrl(id, '/publish'))
      .set(reviewer().auth)
      .send({ revision: 1 })
      .expect(200);
    expect(res.body.documentNodeId).not.toBe(orphan.id);
    expect(await ctx.prisma.node.findUnique({ where: { id: orphan.id } })).toBeNull();
    const row = await ctx.prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: id } });
    expect(row).toMatchObject({ status: 'PUBLISHED', documentNodeId: res.body.documentNodeId });
  });

  it('thư mục "Biên bản họp" bị một mục không phải thư mục chiếm chỗ → dùng lại một thư mục thay thế, không tạo mới mỗi lần', async () => {
    const other = await ctx.prisma.workspace.create({
      data: { name: 'Other', slug: 'other-minutes', kind: 'TEAM', createdById: alice.userId },
    });
    await ctx.prisma.workspaceMember.create({
      data: { workspaceId: other.id, userId: alice.userId, role: 'ADMIN' },
    });
    await ctx.prisma.node.create({
      data: {
        workspaceId: other.id,
        type: 'DOCUMENT',
        section: 'DOCS',
        name: 'Biên bản họp',
        nameNormalized: 'biên bản họp',
        createdById: alice.userId,
        updatedById: alice.userId,
      },
    });
    const run = async () => {
      const meeting = await http()
        .post(`/api/v1/workspaces/${other.id}/meetings`)
        .set(alice.auth)
        .send({ title: 'Họp khác', mode: 'instant' })
        .expect(201);
      await ctx.prisma.meeting.update({
        where: { id: meeting.body.id },
        data: { status: 'ENDED', startedAt: new Date(), endedAt: new Date(), endReason: 'host' },
      });
      await ctx.prisma.meetingMinutes.create({
        data: {
          meetingId: meeting.body.id,
          status: 'AWAITING_REVIEW',
          draftDoc: minutesDoc([]) as object,
          draftRevision: 1,
        },
      });
      await http()
        .post(minutesUrl(meeting.body.id, '/publish'))
        .set(alice.auth)
        .send({ revision: 1 })
        .expect(200);
    };
    await run();
    await run();
    const folders = await ctx.prisma.node.findMany({
      where: { workspaceId: other.id, type: 'FOLDER', parentId: null },
    });
    expect(folders).toHaveLength(1);
  });

  it('vào phòng lần nữa khi buổi họp đang LIVE và bật ghi → vẫn một job record duy nhất', async () => {
    const id = await create(alice, { aiNotesEnabled: true });
    await http().post(`/api/v1/meetings/${id}/join`).set(alice.auth).expect(200);
    await recorderQueue.remove(`record-${id}`);
    expect(await recorderQueue.getJob(`record-${id}`)).toBeFalsy();
    await http().post(`/api/v1/meetings/${id}/join`).set(bob.auth).expect(200);
    expect(await recorderQueue.getJob(`record-${id}`)).toBeTruthy();
  });
});
