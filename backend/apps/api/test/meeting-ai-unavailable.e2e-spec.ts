import { QUEUES } from '@luna/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { APP_CONFIG, loadAppConfig } from '../src/config/app-config.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Meetings without AI providers (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let wsId: string;
  let recorderQueue: Queue;
  const http = () => request(ctx.app.getHttpServer());
  const create = (body: Record<string, unknown> = {}) =>
    http()
      .post(`/api/v1/workspaces/${wsId}/meetings`)
      .set(alice.auth)
      .send({ title: 'Họp', mode: 'instant', ...body });

  beforeAll(async () => {
    ctx = await createTestApp([
      [
        APP_CONFIG,
        { ...loadAppConfig(), MEETING_STT_PROVIDER: 'none', MEETING_LLM_PROVIDER: 'none' },
      ],
    ]);
    await resetDatabase(ctx.prisma);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .send({ name: 'NoAi', slug: 'noai', kind: 'TEAM' })
      .expect(201);
    wsId = ws.body.id;
    recorderQueue = ctx.app.get(getQueueToken(QUEUES.MEETING_RECORDER));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('tạo buổi họp ép aiNotesEnabled=false và báo aiNotesAvailable=false ở cả tạo lẫn chi tiết', async () => {
    const created = await create({ aiNotesEnabled: true }).expect(201);
    expect(created.body).toMatchObject({ aiNotesEnabled: false, aiNotesAvailable: false });
    const row = await ctx.prisma.meeting.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.aiNotesEnabled).toBe(false);
    const detail = await http().get(`/api/v1/meetings/${created.body.id}`).set(alice.auth);
    expect(detail.body).toMatchObject({ aiNotesEnabled: false, aiNotesAvailable: false });
  });

  it('bật ghi biên bản trả 409; tắt vẫn được; sửa lịch bật AI cũng 409', async () => {
    const id = (await create({ aiNotesEnabled: false }).expect(201)).body.id as string;
    const on = await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: true })
      .expect(409);
    expect(on.body.error.message).toBe('AI minutes are not configured');
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: false })
      .expect(200);
    const scheduled = (
      await create({
        mode: 'scheduled',
        scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
      }).expect(201)
    ).body.id as string;
    const patched = await http()
      .patch(`/api/v1/meetings/${scheduled}`)
      .set(alice.auth)
      .send({ aiNotesEnabled: true })
      .expect(409);
    expect(patched.body.error.message).toBe('AI minutes are not configured');
  });

  it('vào phòng không bao giờ xếp job ghi âm, kể cả hàng cũ còn cờ bật', async () => {
    const id = (await create({ aiNotesEnabled: false }).expect(201)).body.id as string;
    await ctx.prisma.meeting.update({ where: { id }, data: { aiNotesEnabled: true } });
    const joined = await http().post(`/api/v1/meetings/${id}/join`).set(alice.auth).expect(200);
    expect(joined.body.aiNotesEnabled).toBe(false);
    expect(await recorderQueue.getJob(`record-${id}`)).toBeFalsy();
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata).aiNotesEnabled).toBe(false);
  });
});
