import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@luna/db';
import { MEETING_ENDED_HOOK, type MeetingEndedHook } from '@luna/meetings';
import { FakeMinutesWriter, FakeSpeechToText } from '@luna/meetings/testing';
import { ObjectStore, QUEUES } from '@luna/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { DelayedError, type Queue } from 'bullmq';
import type { MeetingMinutesProcessor } from '../src/processors/meeting-minutes.processor.js';
import type { MeetingsProcessor } from '../src/processors/meetings.processor.js';

class FakeObjectStore {
  readonly objects = new Map<string, string>();

  put(key: string, body: string): { container: string; key: string } {
    this.objects.set(key, body);
    return { container: 'audio', key };
  }

  async getStream(ref: { key: string }) {
    const body = this.objects.get(ref.key);
    if (body === undefined) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    return { body: Readable.from([Buffer.from(body)]) };
  }

  async delete(ref: { key: string }) {
    this.objects.delete(ref.key);
  }

  destroy() {}
}

describe('Meeting minutes worker (e2e)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplicationContext;
  let prisma: PrismaClient;
  let processor: MeetingMinutesProcessor;
  let meetings: MeetingsProcessor;
  let minutesQueue: Queue;
  let endedHook: MeetingEndedHook;
  let store: FakeObjectStore;
  let stt: FakeSpeechToText;
  let writer: FakeMinutesWriter;
  let seq = 0;
  let config: { MEETING_STT_PROVIDER: string; MEETING_LLM_PROVIDER: string };

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const makeJob = (name: string, data: object, attemptsMade = 0, attempts = 4) => ({
    name,
    data,
    attemptsMade,
    opts: { attempts },
    moveToDelayed: vi.fn(async () => undefined),
  });
  const run = (name: string, data: object = {}, attemptsMade = 0) =>
    processor.process(makeJob(name, data, attemptsMade) as never, 'token');
  const runAllAttempts = async (meetingId: string) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await run('process', { meetingId }, attempt);
      } catch {
        continue;
      }
    }
  };

  const user = (tag: string, name = tag) =>
    prisma.user.create({
      data: { email: `${tag}${++seq}@lunatech.vn`, name, status: 'ACTIVE' },
    });

  const setup = async (opts: { audioCompleted?: boolean; endedMinutesAgo?: number } = {}) => {
    const host = await user('host', 'Chủ trì');
    const ws = await prisma.workspace.create({
      data: { name: `W${++seq}`, slug: `w${seq}`, kind: 'TEAM', createdById: host.id },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: host.id, role: 'ADMIN' },
    });
    const endedMinutesAgo = opts.endedMinutesAgo ?? 30;
    const meeting = await prisma.meeting.create({
      data: {
        workspaceId: ws.id,
        createdById: host.id,
        title: 'Sprint 13',
        status: 'ENDED',
        startedAt: minutesAgo(endedMinutesAgo + 60),
        endedAt: minutesAgo(endedMinutesAgo),
      },
    });
    const minutes = await prisma.meetingMinutes.create({
      data: {
        meetingId: meeting.id,
        status: 'RECORDING',
        audioCompletedAt: opts.audioCompleted === false ? null : minutesAgo(endedMinutesAgo),
        audioPurgeAfter: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    return { host, ws, meeting, minutes };
  };

  const member = async (workspaceId: string, name: string) => {
    const u = await user('m', name);
    await prisma.workspaceMember.create({ data: { workspaceId, userId: u.id, role: 'MEMBER' } });
    return u;
  };

  const chunk = async (
    meetingId: string,
    userId: string,
    startOffsetMs: number,
    segments?: Array<{ startMs: number; endMs: number; text: string }>,
  ) => {
    const key = `meetings/${meetingId}/${userId}/${startOffsetMs}.ogg`;
    const ref = store.put(key, key);
    if (segments) stt.setSegments(key, segments);
    return prisma.meetingAudioChunk.create({
      data: {
        meetingId,
        userId,
        startOffsetMs,
        durationMs: 20_000,
        container: ref.container,
        key,
        sizeBytes: 100n,
      },
    });
  };

  const attend = (meetingId: string, userId: string) =>
    prisma.meetingAttendance.create({
      data: { meetingId, userId, joinedAt: minutesAgo(80), leftAt: minutesAgo(40) },
    });

  const notifications = async (type: string, meetingId: string) =>
    prisma.notification.findMany({
      where: { type, payload: { path: ['meetingId'], equals: meetingId } },
    });

  beforeAll(async () => {
    [pg, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    Object.assign(process.env, {
      NODE_ENV: 'test',
      WORKER_METRICS_PORT: '0',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: pg.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
      S3_ENDPOINT: 'http://localhost:1',
      S3_ACCESS_KEY: 'unused',
      S3_SECRET_KEY: 'unused',
      S3_BUCKET_TMP: 'unused',
      S3_BUCKET_HLS: 'unused',
      S3_BUCKET_PREVIEWS: 'unused',
      S3_BUCKET_THUMBNAILS: 'unused',
      S3_BUCKET_ASSETS: 'unused',
      S3_BUCKET_ORIGINALS: 'unused',
      TIKA_URL: 'http://localhost:1',
      GOTENBERG_URL: 'http://localhost:1',
      VIDEO_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
      MEILI_URL: 'http://localhost:1',
      MEILI_MASTER_KEY: 'unused-meili-master-key',
      LIVEKIT_URL: 'wss://fake.livekit.test',
      LIVEKIT_API_KEY: 'fake-livekit-key',
      LIVEKIT_API_SECRET: 'fake-livekit-secret-0123456789abcdef',
      MEETING_STT_PROVIDER: 'fake',
      MEETING_LLM_PROVIDER: 'fake',
    });
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: fileURLToPath(new URL('../../../packages/db', import.meta.url)),
      env: process.env,
      stdio: 'pipe',
    });
    store = new FakeObjectStore();
    const { WorkerModule } = await import('../src/worker.module.js');
    const { MeetingMinutesProcessor, SPEECH_TO_TEXT, MINUTES_WRITER } =
      await import('../src/processors/meeting-minutes.processor.js');
    const { MeetingsProcessor } = await import('../src/processors/meetings.processor.js');
    const { PrismaService } = await import('../src/infra/prisma.provider.js');
    const { WORKER_CONFIG } = await import('../src/config/worker-config.js');
    app = await (
      await Test.createTestingModule({ imports: [WorkerModule] })
        .overrideProvider(ObjectStore)
        .useValue(store)
        .compile()
    ).init();
    processor = app.get(MeetingMinutesProcessor);
    meetings = app.get(MeetingsProcessor);
    prisma = app.get(PrismaService).client;
    config = app.get(WORKER_CONFIG);
    stt = app.get(SPEECH_TO_TEXT);
    writer = app.get(MINUTES_WRITER);
    endedHook = app.get(MEETING_ENDED_HOOK);
    minutesQueue = app.get(getQueueToken(QUEUES.MEETING_MINUTES));
  }, 180_000);

  beforeEach(() => {
    stt.calls.length = 0;
    stt.segments.clear();
    stt.failTimes(0, true);
    writer.calls.length = 0;
    writer.draft = null;
    writer.failTimes(0, true);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('đầy đủ: 3 người, 5 đoạn → lời nói có mốc đúng, biên bản chờ duyệt, âm thanh bị xoá, dòng chi phí, thông báo chủ trì', async () => {
    const { host, ws, meeting } = await setup();
    const a = await member(ws.id, 'An');
    const b = await member(ws.id, 'Bình');
    const seg = (text: string) => [{ startMs: 1000, endMs: 4000, text }];
    const c1 = await chunk(meeting.id, host.id, 0, seg('chào mọi người'));
    await chunk(meeting.id, a.id, 30_000, seg('em làm phần đăng nhập'));
    await chunk(meeting.id, b.id, 60_000, seg('em kiểm thử'));
    await chunk(meeting.id, host.id, 90_000, seg('chốt nhé'));
    await chunk(meeting.id, a.id, 120_000, seg('ok anh'));
    for (const u of [host, a, b]) await attend(meeting.id, u.id);

    await run('process', { meetingId: meeting.id });

    const utterances = await prisma.meetingUtterance.findMany({
      where: { meetingId: meeting.id },
      orderBy: { startMs: 'asc' },
    });
    expect(utterances.map((u) => u.startMs)).toEqual([1000, 31_000, 61_000, 91_000, 121_000]);
    expect(utterances[0]!.chunkId).toBe(c1.id);
    expect(utterances[0]!.endMs).toBe(4000);

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
    expect(row.draftRevision).toBe(1);
    expect(row.draft).not.toBeNull();
    expect(row.draftDoc).not.toBeNull();
    expect(row.transcriptCompletedAt).not.toBeNull();
    expect(row.audioPurgedAt).not.toBeNull();
    expect(row.error).toBeNull();
    expect(row.failedStage).toBeNull();
    expect(JSON.stringify(row.draftDoc)).toContain('Chủ trì');

    expect(store.objects.size).toBe(0);
    const chunks = await prisma.meetingAudioChunk.findMany({ where: { meetingId: meeting.id } });
    expect(chunks.every((c) => c.deletedAt !== null)).toBe(true);

    const usage = await prisma.meetingAiUsage.findMany({ where: { meetingId: meeting.id } });
    expect(usage.filter((u) => u.kind === 'stt')).toHaveLength(5);
    expect(usage.filter((u) => u.kind === 'stt').every((u) => u.audioMs === 20_000)).toBe(true);
    expect(usage.filter((u) => u.kind === 'llm')).toHaveLength(1);
    expect(usage.every((u) => u.workspaceId === ws.id)).toBe(true);

    const review = await notifications('meeting.minutes_review', meeting.id);
    expect(review.map((n) => n.userId)).toEqual([host.id]);
    const audit = await prisma.auditLog.findMany({
      where: { action: 'meeting.minutes_draft', targetId: meeting.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBeNull();
    expect(writer.calls).toHaveLength(1);
  });

  it('chạy lại job đã xong không gọi STT hay LLM lần nữa', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    await attend(meeting.id, host.id);
    await run('process', { meetingId: meeting.id });
    const sttCalls = stt.calls.length;
    const llmCalls = writer.calls.length;
    expect(llmCalls).toBe(1);

    await run('process', { meetingId: meeting.id });

    expect(stt.calls).toHaveLength(sttCalls);
    expect(writer.calls).toHaveLength(llmCalls);
    expect(await notifications('meeting.minutes_review', meeting.id)).toHaveLength(1);
  });

  it('STT lỗi tạm thời rồi khỏi: chỉ chép lại đoạn chưa chép', async () => {
    const { host, ws, meeting } = await setup();
    const a = await member(ws.id, 'An');
    await chunk(meeting.id, host.id, 0);
    await chunk(meeting.id, a.id, 30_000);
    await chunk(meeting.id, a.id, 60_000);
    stt.failTimes(1, true);

    await expect(run('process', { meetingId: meeting.id }, 0)).rejects.toThrow();
    expect(stt.calls).toHaveLength(3);
    const mid = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(mid.status).toBe('PROCESSING');
    expect(await prisma.meetingUtterance.count({ where: { meetingId: meeting.id } })).toBe(2);

    stt.calls.length = 0;
    await run('process', { meetingId: meeting.id }, 1);

    expect(stt.calls).toHaveLength(1);
    expect(await prisma.meetingUtterance.count({ where: { meetingId: meeting.id } })).toBe(3);
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
  });

  it('LLM lỗi hết số lần: FAILED ở bước draft, lời nói còn, âm thanh đã xoá, thông báo meeting.minutes_failed', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    writer.failTimes(10, true);

    await runAllAttempts(meeting.id);

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('FAILED');
    expect(row.failedStage).toBe('draft');
    expect(row.error).toBeTruthy();
    expect(row.error!.length).toBeLessThanOrEqual(500);
    expect(await prisma.meetingUtterance.count({ where: { meetingId: meeting.id } })).toBe(1);
    expect(store.objects.size).toBe(0);
    expect(row.audioPurgedAt).not.toBeNull();
    expect(stt.calls).toHaveLength(1);
    const failed = await notifications('meeting.minutes_failed', meeting.id);
    expect(failed.map((n) => n.userId)).toEqual([host.id]);
  });

  it('provider none: FAILED ở bước config, không gọi nhà cung cấp, không thử lại', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    config.MEETING_STT_PROVIDER = 'none';
    try {
      await run('process', { meetingId: meeting.id });
    } finally {
      config.MEETING_STT_PROVIDER = 'fake';
    }

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('FAILED');
    expect(row.failedStage).toBe('config');
    expect(row.error).toBe('AI minutes are not configured');
    expect(stt.calls).toHaveLength(0);
    expect(writer.calls).toHaveLength(0);
    expect(store.objects.size).toBeGreaterThan(0);
    expect(await notifications('meeting.minutes_failed', meeting.id)).toHaveLength(1);
    store.objects.clear();
  });

  it('lỗi không thử lại được: FAILED ngay lần đầu và ném UnrecoverableError', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    writer.failTimes(1, false);

    await expect(run('process', { meetingId: meeting.id }, 0)).rejects.toMatchObject({
      name: 'UnrecoverableError',
    });

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('FAILED');
    expect(row.failedStage).toBe('draft');
  });

  it('STT lỗi hết số lần: FAILED ở bước transcribe, âm thanh giữ lại tới audioPurgeAfter', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    stt.failTimes(100, true);

    await runAllAttempts(meeting.id);

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('FAILED');
    expect(row.failedStage).toBe('transcribe');
    expect(row.audioPurgedAt).toBeNull();
    expect(store.objects.size).toBeGreaterThan(0);
    const chunks = await prisma.meetingAudioChunk.findMany({ where: { meetingId: meeting.id } });
    expect(chunks.every((c) => c.deletedAt === null)).toBe(true);
    expect(writer.calls).toHaveLength(0);
    expect(await notifications('meeting.minutes_failed', meeting.id)).toHaveLength(1);
    store.objects.clear();
  });

  it('đoạn lỗi không thử lại được bị bỏ qua kèm cảnh báo, biên bản vẫn ra', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    await chunk(meeting.id, host.id, 30_000);
    stt.failTimes(1, false);

    await run('process', { meetingId: meeting.id });

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
    expect(row.error).toContain('bỏ qua 1 đoạn');
    expect(await prisma.meetingUtterance.count({ where: { meetingId: meeting.id } })).toBe(1);
  });

  it('không có lời nói: không gọi LLM, bản nháp chỉ có chat', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0, []);
    await prisma.meetingChatMessage.create({
      data: {
        meetingId: meeting.id,
        userId: host.id,
        body: 'link tài liệu',
        createdAt: minutesAgo(50),
      },
    });

    await run('process', { meetingId: meeting.id });

    expect(writer.calls).toHaveLength(0);
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
    const doc = JSON.stringify(row.draftDoc);
    expect(doc).toContain('Không có lời nói được ghi lại');
    expect(doc).toContain('link tài liệu');
    expect(doc).toContain('4. Tin nhắn chat đáng chú ý');
    const usage = await prisma.meetingAiUsage.findMany({ where: { meetingId: meeting.id } });
    expect(usage.map((u) => u.kind)).toEqual(['stt']);
  });

  it('bản ghi quá dài: cắt phần giữa, ghi cảnh báo, vẫn ra bản nháp', async () => {
    const { host, meeting } = await setup();
    const big = (s: string) => 'x'.repeat(150_000) + s;
    await chunk(meeting.id, host.id, 0, [
      { startMs: 0, endMs: 1000, text: big(' đầu') },
      { startMs: 5000, endMs: 6000, text: big(' giữa') },
      { startMs: 10_000, endMs: 11_000, text: big(' cuối') },
    ]);

    await run('process', { meetingId: meeting.id });

    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0]!.user.length).toBeLessThan(420_000);
    expect(writer.calls[0]!.user).toContain('lược bớt');
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
    expect(row.error).toContain('quá dài');
  });

  it('âm thanh chưa xong và buổi họp mới kết thúc: job hoãn 30 giây, không đổi trạng thái', async () => {
    const { meeting } = await setup({ audioCompleted: false, endedMinutesAgo: 1 });
    const job = makeJob('process', { meetingId: meeting.id });

    await expect(processor.process(job as never, 'token')).rejects.toBeInstanceOf(DelayedError);

    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    const [until, token] = job.moveToDelayed.mock.calls[0] as unknown as [number, string];
    expect(until - Date.now()).toBeGreaterThan(20_000);
    expect(until - Date.now()).toBeLessThanOrEqual(30_000);
    expect(token).toBe('token');
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('RECORDING');
  });

  it('buổi họp còn LIVE: job hoãn 30 giây và ném DelayedError, không hoàn tất, không đổi trạng thái', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'LIVE', endedAt: null },
    });
    const job = makeJob('process', { meetingId: meeting.id });

    await expect(processor.process(job as never, 'token')).rejects.toBeInstanceOf(DelayedError);

    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    const [until, token] = job.moveToDelayed.mock.calls[0] as unknown as [number, string];
    expect(until - Date.now()).toBeGreaterThan(20_000);
    expect(until - Date.now()).toBeLessThanOrEqual(30_000);
    expect(token).toBe('token');
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('RECORDING');
    expect(stt.calls).toHaveLength(0);
  });

  it('buổi họp bị huỷ: bỏ qua, không hoãn', async () => {
    const { meeting } = await setup();
    await prisma.meeting.update({ where: { id: meeting.id }, data: { status: 'CANCELLED' } });
    const job = makeJob('process', { meetingId: meeting.id });
    await expect(processor.process(job as never, 'token')).resolves.toEqual({
      skipped: 'not_ended',
    });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it('hàng đã FAILED không bị worker nhận lại: chỉ API retry mới đưa về PROCESSING', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    await prisma.meetingMinutes.update({
      where: { meetingId: meeting.id },
      data: { status: 'FAILED', failedStage: 'draft', error: 'lỗi cũ' },
    });

    await expect(run('process', { meetingId: meeting.id })).resolves.toEqual({
      skipped: 'claimed_elsewhere',
    });

    expect(stt.calls).toHaveLength(0);
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('FAILED');
    expect(row.error).toBe('lỗi cũ');
    store.objects.clear();
  });

  it('âm thanh chưa báo xong nhưng đã quá thời gian chờ: vẫn xử lý phần đã có', async () => {
    const { host, meeting } = await setup({ audioCompleted: false, endedMinutesAgo: 30 });
    await chunk(meeting.id, host.id, 0);

    await run('process', { meetingId: meeting.id });

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
  });

  it('purge-audio xoá âm thanh quá hạn, giữ âm thanh chưa tới hạn', async () => {
    const old = await setup();
    const fresh = await setup();
    const c1 = await chunk(old.meeting.id, old.host.id, 0);
    const c2 = await chunk(fresh.meeting.id, fresh.host.id, 0);
    await prisma.meetingMinutes.update({
      where: { meetingId: old.meeting.id },
      data: { audioPurgeAfter: minutesAgo(5) },
    });

    await run('purge-audio');

    expect(store.objects.has(c1.key)).toBe(false);
    expect(store.objects.has(c2.key)).toBe(true);
    const oldChunk = await prisma.meetingAudioChunk.findUniqueOrThrow({ where: { id: c1.id } });
    const freshChunk = await prisma.meetingAudioChunk.findUniqueOrThrow({ where: { id: c2.id } });
    expect(oldChunk.deletedAt).not.toBeNull();
    expect(freshChunk.deletedAt).toBeNull();
    const oldRow = await prisma.meetingMinutes.findUniqueOrThrow({
      where: { meetingId: old.meeting.id },
    });
    expect(oldRow.audioPurgedAt).not.toBeNull();
    store.objects.delete(c2.key);
  });

  it('gợi ý người vắng: "anh Hùng sẽ làm" khớp thành viên Hùng duy nhất; người ngoài workspace không được gợi ý', async () => {
    const { host, ws, meeting } = await setup();
    const hung = await member(ws.id, 'Hùng');
    await user('outsider', 'Mai');
    await chunk(meeting.id, host.id, 0, [{ startMs: 0, endMs: 3000, text: 'anh Hùng sẽ làm' }]);
    await attend(meeting.id, host.id);
    const item = (task: string, ownerName: string) => ({
      task,
      ownerSpeakerId: null,
      ownerName,
      dueText: null,
      dueDate: null,
      ambiguous: false,
      evidence: ['U1'],
    });
    writer.draft = {
      overview: { summary: 'tóm tắt', decisions: [], deferred: [], openQuestions: [] },
      actionItems: [item('Làm phần A', 'anh Hùng'), item('Làm phần B', 'Mai')],
      topics: [],
      notableChat: [],
    };

    await run('process', { meetingId: meeting.id });

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.suggestions).toEqual([
      { actionIndex: 0, name: 'anh Hùng', userId: hung.id, userName: 'Hùng' },
    ]);
    expect(JSON.stringify(row.draftDoc)).toContain('"suggested":true');
  });

  it('hai job process song song: chỉ một job chạy, một lần gọi LLM, một dòng audit, một thông báo, không cảnh báo giả', async () => {
    const { host, ws, meeting } = await setup();
    const a = await member(ws.id, 'An');
    await chunk(meeting.id, host.id, 0);
    await chunk(meeting.id, a.id, 30_000);
    await chunk(meeting.id, a.id, 60_000);

    await Promise.all([
      processor.process(makeJob('process', { meetingId: meeting.id }, 0) as never, 't1'),
      processor.process(makeJob('process', { meetingId: meeting.id }, 0) as never, 't2'),
    ]);

    expect(writer.calls).toHaveLength(1);
    expect(stt.calls).toHaveLength(3);
    expect(
      await prisma.auditLog.count({
        where: { action: 'meeting.minutes_draft', targetId: meeting.id },
      }),
    ).toBe(1);
    expect(await notifications('meeting.minutes_review', meeting.id)).toHaveLength(1);
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
    expect(row.error).toBeNull();
    expect(row.claimedBy).not.toBeNull();
  });

  it('job khác đang giữ claim còn hạn: không làm gì; claim hết hạn: tiếp quản', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    await prisma.meetingMinutes.update({
      where: { meetingId: meeting.id },
      data: {
        status: 'PROCESSING',
        claimedBy: 'other-job',
        claimExpiresAt: new Date(Date.now() + 600_000),
      },
    });

    await run('process', { meetingId: meeting.id });
    expect(stt.calls).toHaveLength(0);
    expect(writer.calls).toHaveLength(0);

    await prisma.meetingMinutes.update({
      where: { meetingId: meeting.id },
      data: { claimExpiresAt: minutesAgo(1) },
    });
    await run('process', { meetingId: meeting.id });
    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
    expect(writer.calls).toHaveLength(1);
  });

  it('đoạn âm thanh thêm vào sau khi đã liệt kê: vẫn được chép lời trước khi xoá', async () => {
    const { host, ws, meeting } = await setup();
    const a = await member(ws.id, 'An');
    await chunk(meeting.id, host.id, 0);
    const original = stt.transcribe.bind(stt);
    let injected = false;
    const spy = vi.spyOn(stt, 'transcribe').mockImplementation(async (audio, opts) => {
      if (!injected) {
        injected = true;
        await chunk(meeting.id, a.id, 30_000);
      }
      return original(audio, opts);
    });

    await run('process', { meetingId: meeting.id });
    spy.mockRestore();

    expect(await prisma.meetingUtterance.count({ where: { meetingId: meeting.id } })).toBe(2);
    expect(stt.calls).toHaveLength(2);
    const chunks = await prisma.meetingAudioChunk.findMany({ where: { meetingId: meeting.id } });
    expect(chunks.every((c) => c.transcribedAt !== null && c.deletedAt !== null)).toBe(true);
    expect(store.objects.size).toBe(0);
  });

  it.each([401, 402, 403])(
    'STT trả %i (khoá, hạn mức, thanh toán): FAILED ở bước transcribe, giữ âm thanh, không bỏ qua đoạn',
    async (status) => {
      const { host, ws, meeting } = await setup();
      const a = await member(ws.id, 'An');
      await chunk(meeting.id, host.id, 0);
      await chunk(meeting.id, a.id, 30_000);
      stt.failTimes(1, false, status);

      await expect(run('process', { meetingId: meeting.id }, 0)).rejects.toMatchObject({
        name: 'UnrecoverableError',
      });

      const row = await prisma.meetingMinutes.findUniqueOrThrow({
        where: { meetingId: meeting.id },
      });
      expect(row.status).toBe('FAILED');
      expect(row.failedStage).toBe('transcribe');
      expect(row.audioPurgedAt).toBeNull();
      const chunks = await prisma.meetingAudioChunk.findMany({ where: { meetingId: meeting.id } });
      expect(chunks.filter((c) => c.transcribedAt !== null)).toHaveLength(1);
      expect(chunks.every((c) => c.deletedAt === null)).toBe(true);
      expect(writer.calls).toHaveLength(0);
      store.objects.clear();
    },
  );

  it('STT trả 422 cho một đoạn: bỏ qua đoạn đó; mọi đoạn đều bị bỏ qua thì FAILED ở transcribe', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    stt.failTimes(1, false, 422);

    await expect(run('process', { meetingId: meeting.id }, 0)).rejects.toMatchObject({
      name: 'UnrecoverableError',
    });

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('FAILED');
    expect(row.failedStage).toBe('transcribe');
    expect(row.audioPurgedAt).toBeNull();
    expect(writer.calls).toHaveLength(0);
    store.objects.clear();
  });

  it('mọi đoạn đều bị bỏ qua nhưng có chat: rơi về bản nháp chỉ có chat, kèm cảnh báo, không gọi LLM', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    await prisma.meetingChatMessage.create({
      data: {
        meetingId: meeting.id,
        userId: host.id,
        body: 'gửi file giúp',
        createdAt: minutesAgo(50),
      },
    });
    stt.failTimes(1, false, 422);

    await run('process', { meetingId: meeting.id });

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.status).toBe('AWAITING_REVIEW');
    expect(row.failedStage).toBeNull();
    expect(row.error).toContain('không chép lời được');
    expect(JSON.stringify(row.draftDoc)).toContain('gửi file giúp');
    expect(writer.calls).toHaveLength(0);
  });

  it('người dự im lặng nhưng khớp tên: được gắn như người dự, không phải gợi ý người vắng', async () => {
    const { host, ws, meeting } = await setup();
    const hung = await member(ws.id, 'Hùng');
    await chunk(meeting.id, host.id, 0, [{ startMs: 0, endMs: 3000, text: 'anh Hùng sẽ làm' }]);
    await attend(meeting.id, host.id);
    await attend(meeting.id, hung.id);
    writer.draft = {
      overview: { summary: 'tóm tắt', decisions: [], deferred: [], openQuestions: [] },
      actionItems: [
        {
          task: 'Làm phần A',
          ownerSpeakerId: null,
          ownerName: 'anh Hùng',
          dueText: null,
          dueDate: null,
          ambiguous: false,
          evidence: ['U1'],
        },
      ],
      topics: [],
      notableChat: [],
    };

    await run('process', { meetingId: meeting.id });

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(row.suggestions).toEqual([
      { actionIndex: 0, name: 'anh Hùng', userId: hung.id, userName: 'Hùng' },
    ]);
    const doc = JSON.stringify(row.draftDoc);
    expect(doc).toContain(`"id":"${hung.id}"`);
    expect(doc).toContain('"suggested":false');
    expect(doc).not.toContain('"suggested":true');
  });

  it('người được mời nhưng đã bị khoá không có trong danh sách vắng', async () => {
    const { host, meeting } = await setup();
    await chunk(meeting.id, host.id, 0);
    const gone = await prisma.user.create({
      data: { email: `gone${++seq}@lunatech.vn`, name: 'Người Đã Nghỉ', status: 'DISABLED' },
    });
    await prisma.meetingInvite.create({ data: { meetingId: meeting.id, userId: gone.id } });

    await run('process', { meetingId: meeting.id });

    const row = await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: meeting.id } });
    expect(JSON.stringify(row.draftDoc)).not.toContain('Người Đã Nghỉ');
  });

  it('hook kết thúc chỉ enqueue khi có dòng meeting_minutes, kèm độ trễ chờ âm thanh', async () => {
    const withRow = await setup();
    const bare = await setup();
    await prisma.meetingMinutes.delete({ where: { meetingId: bare.meeting.id } });

    await endedHook({ id: withRow.meeting.id, workspaceId: withRow.ws.id, aiNotesEnabled: true });
    await endedHook({ id: bare.meeting.id, workspaceId: bare.ws.id, aiNotesEnabled: false });

    const job = await minutesQueue.getJob(`minutes-${withRow.meeting.id}`);
    expect(job).toBeDefined();
    expect(job!.opts.delay).toBe(900_000);
    expect(await minutesQueue.getJob(`minutes-${bare.meeting.id}`)).toBeUndefined();
  });

  it('quét định kỳ: buổi đã kết thúc quá hạn mà chưa có job thì được enqueue lại, buổi mới thì không', async () => {
    const lost = await setup({ audioCompleted: false, endedMinutesAgo: 30 });
    const recent = await setup({ audioCompleted: false, endedMinutesAgo: 10 });
    const covered = await setup({ audioCompleted: false, endedMinutesAgo: 30 });
    await minutesQueue.add(
      'process',
      { meetingId: covered.meeting.id },
      { jobId: `minutes-${covered.meeting.id}`, delay: 600_000 },
    );

    const result = await meetings.reconcile();
    await meetings.reconcile();

    expect(result.minutesRecovered).toBeGreaterThanOrEqual(1);
    expect(await minutesQueue.getJob(`minutes-${lost.meeting.id}-retry-900`)).toBeDefined();
    expect(await minutesQueue.getJob(`minutes-${recent.meeting.id}-retry-900`)).toBeUndefined();
    expect(await minutesQueue.getJob(`minutes-${covered.meeting.id}-retry-900`)).toBeUndefined();
  });
});
