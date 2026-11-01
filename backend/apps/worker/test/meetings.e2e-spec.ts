import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@luna/db';
import { MEETING_MEDIA, roomNameFor } from '@luna/meetings';
import { FakeMeetingMedia } from '@luna/meetings/testing';
import { QUEUES } from '@luna/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { redisConnection } from '../src/config/worker-config.js';
import type { MeetingsProcessor } from '../src/processors/meetings.processor.js';

describe('Meetings worker (e2e)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplicationContext;
  let prisma: PrismaClient;
  let processor: MeetingsProcessor;
  let media: FakeMeetingMedia;
  let queue: Queue;
  let rawRedis: Redis;
  let seq = 0;

  const run = (name: string, data: object = {}) => processor.process({ name, data } as never);
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const user = async (tag: string, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') =>
    prisma.user.create({
      data: { email: `${tag}${++seq}@lunatech.vn`, name: tag, status },
    });
  let companyId: string | undefined;
  const workspace = async (ownerId: string, kind: 'TEAM' | 'COMPANY') => {
    if (kind === 'COMPANY' && companyId) return { id: companyId };
    const created = await prisma.workspace.create({
      data: { name: `W${++seq}`, slug: `w${seq}`, kind, createdById: ownerId },
    });
    if (kind === 'COMPANY') companyId = created.id;
    return created;
  };
  const scheduled = (workspaceId: string, createdById: string, scheduledAt: Date) =>
    prisma.meeting.create({
      data: { workspaceId, createdById, title: 'Sync', status: 'SCHEDULED', scheduledAt },
    });
  const live = (workspaceId: string, createdById: string, startedAt: Date) =>
    prisma.meeting.create({
      data: { workspaceId, createdById, title: 'Live', status: 'LIVE', startedAt },
    });
  const reminded = async (meetingId: string) =>
    (
      await prisma.notification.findMany({
        where: { type: 'meeting.reminder', payload: { path: ['meetingId'], equals: meetingId } },
      })
    )
      .map((n) => n.userId)
      .sort();

  beforeAll(async () => {
    [pg, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    Object.assign(process.env, {
      NODE_ENV: 'test',
      WORKER_METRICS_PORT: '0',
      LOG_LEVEL: 'warn',
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
      MEETING_EMPTY_GRACE_SEC: '120',
    });
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: fileURLToPath(new URL('../../../packages/db', import.meta.url)),
      env: process.env,
      stdio: 'pipe',
    });
    media = new FakeMeetingMedia();
    const { WorkerModule } = await import('../src/worker.module.js');
    const { MeetingsProcessor } = await import('../src/processors/meetings.processor.js');
    const { PrismaService } = await import('../src/infra/prisma.provider.js');
    app = await (
      await Test.createTestingModule({ imports: [WorkerModule] })
        .overrideProvider(MEETING_MEDIA)
        .useValue(media)
        .compile()
    ).init();
    processor = app.get(MeetingsProcessor);
    prisma = app.get(PrismaService).client;
    rawRedis = new Redis(process.env.REDIS_URL!);
    queue = new Queue(QUEUES.MEETINGS, {
      connection: redisConnection(process.env.REDIS_URL!),
      prefix: 'luna',
    });
  }, 180_000);

  afterAll(async () => {
    await queue?.close();
    rawRedis?.disconnect();
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('đổi giờ buổi họp: nhắc theo giờ mới, job giờ cũ chạy không gửi gì', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const invitee = await user('invitee');
    const oldAt = new Date(Date.now() + 3_600_000);
    const m = await scheduled(ws.id, owner.id, oldAt);
    await prisma.meetingInvite.create({ data: { meetingId: m.id, userId: invitee.id } });
    const newAt = new Date(Date.now() + 7_200_000);
    await prisma.meeting.update({ where: { id: m.id }, data: { scheduledAt: newAt } });

    await run('remind', { meetingId: m.id, scheduledAt: oldAt.toISOString() });
    expect(await reminded(m.id)).toEqual([]);

    await run('remind', { meetingId: m.id, scheduledAt: newAt.toISOString() });
    expect(await reminded(m.id)).toEqual([invitee.id, owner.id].sort());
  });

  it('huỷ buổi họp: job nhắc chạy không gửi gì', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const at = new Date(Date.now() + 3_600_000);
    const m = await scheduled(ws.id, owner.id, at);
    await prisma.meeting.update({
      where: { id: m.id },
      data: { status: 'CANCELLED', endedAt: new Date(), endReason: 'cancelled' },
    });
    await run('remind', { meetingId: m.id, scheduledAt: at.toISOString() });
    expect(await reminded(m.id)).toEqual([]);
  });

  it('nhắc gửi tới người tạo và người được mời; workspace TEAM gửi cả thành viên, COMPANY thì không', async () => {
    const owner = await user('owner');
    const member = await user('member');
    const disabled = await user('disabled', 'DISABLED');
    const invitee = await user('invitee');
    const outsider = await user('outsider');
    const team = await workspace(owner.id, 'TEAM');
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: team.id, userId: owner.id, role: 'ADMIN' },
        { workspaceId: team.id, userId: member.id, role: 'MEMBER' },
        { workspaceId: team.id, userId: disabled.id, role: 'MEMBER' },
      ],
    });
    const at = new Date(Date.now() + 3_600_000);
    const m = await scheduled(team.id, owner.id, at);
    await prisma.meetingInvite.create({ data: { meetingId: m.id, userId: invitee.id } });
    await run('remind', { meetingId: m.id, scheduledAt: at.toISOString() });
    expect(await reminded(m.id)).toEqual([owner.id, member.id, invitee.id].sort());
    const n = await prisma.notification.findFirstOrThrow({
      where: { userId: member.id, type: 'meeting.reminder' },
    });
    expect(n.payload).toEqual({
      meetingId: m.id,
      workspaceId: team.id,
      title: 'Sync',
      scheduledAt: at.toISOString(),
    });

    const company = await workspace(owner.id, 'COMPANY');
    await prisma.workspaceMember.create({
      data: { workspaceId: company.id, userId: outsider.id, role: 'MEMBER' },
    });
    const cm = await scheduled(company.id, owner.id, at);
    await prisma.meetingInvite.create({ data: { meetingId: cm.id, userId: invitee.id } });
    await run('remind', { meetingId: cm.id, scheduledAt: at.toISOString() });
    expect(await reminded(cm.id)).toEqual([owner.id, invitee.id].sort());
  });

  it('đối soát: phòng không còn trên LiveKit → buổi họp ENDED reason empty, phiên mở được đóng', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const m = await live(ws.id, owner.id, minutesAgo(10));
    await prisma.meetingAttendance.create({
      data: { meetingId: m.id, userId: owner.id, joinedAt: minutesAgo(9) },
    });
    await run('reconcile');
    const after = await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ status: 'ENDED', endReason: 'empty' });
    const att = await prisma.meetingAttendance.findFirstOrThrow({ where: { meetingId: m.id } });
    expect(att.leftAt).not.toBeNull();
  });

  const emptyKey = (id: string) => `meeting-empty-since:${id}`;
  const status = async (id: string) =>
    (await prisma.meeting.findUniqueOrThrow({ where: { id } })).status;

  it('đối soát: phòng vừa trống chưa bị kết thúc dù buổi họp đã diễn ra lâu', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const longRunning = await live(ws.id, owner.id, minutesAgo(90));
    const fresh = await live(ws.id, owner.id, minutesAgo(1));
    media.rooms.set(roomNameFor(longRunning.id), { metadata: '{}', participants: [] });
    media.rooms.set(roomNameFor(fresh.id), { metadata: '{}', participants: [] });
    const freshNoRoom = await live(ws.id, owner.id, minutesAgo(1));
    await run('reconcile');
    expect(await status(longRunning.id)).toBe('LIVE');
    expect(await status(fresh.id)).toBe('LIVE');
    expect(await status(freshNoRoom.id)).toBe('LIVE');
    const marker = Number(await rawRedis.get(emptyKey(longRunning.id)));
    expect(Date.now() - marker).toBeLessThan(30_000);
    const ttl = await rawRedis.ttl(emptyKey(longRunning.id));
    expect(ttl).toBeGreaterThan(120);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('đối soát: phòng trống (hoặc chỉ người ẩn) quá thời gian chờ thì kết thúc và xoá dấu', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const emptyOld = await live(ws.id, owner.id, minutesAgo(10));
    const hiddenOnly = await live(ws.id, owner.id, minutesAgo(10));
    media.rooms.set(roomNameFor(emptyOld.id), { metadata: '{}', participants: [] });
    media.rooms.set(roomNameFor(hiddenOnly.id), {
      metadata: '{}',
      participants: [{ identity: 'luna-recorder', joinedAt: new Date(), hidden: true }],
    });
    await run('reconcile');
    expect(await status(emptyOld.id)).toBe('LIVE');
    expect(await status(hiddenOnly.id)).toBe('LIVE');
    for (const m of [emptyOld, hiddenOnly]) {
      await rawRedis.set(emptyKey(m.id), String(Date.now() - 300_000), 'EX', 600);
    }
    await run('reconcile');
    expect(await status(emptyOld.id)).toBe('ENDED');
    expect(await status(hiddenOnly.id)).toBe('ENDED');
    expect(await rawRedis.get(emptyKey(emptyOld.id))).toBeNull();
  });

  it('đối soát: có người vào lại thì xoá dấu phòng trống', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const m = await live(ws.id, owner.id, minutesAgo(30));
    media.rooms.set(roomNameFor(m.id), {
      metadata: '{}',
      participants: [{ identity: owner.id, joinedAt: new Date(), hidden: false }],
    });
    await rawRedis.set(emptyKey(m.id), String(Date.now() - 300_000), 'EX', 600);
    await run('reconcile');
    expect(await status(m.id)).toBe('LIVE');
    expect(await rawRedis.get(emptyKey(m.id))).toBeNull();
  });

  it('đối soát: huỷ buổi họp SCHEDULED quá giờ hẹn hơn 24 giờ mà chưa ai vào, ghi audit', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const stale = await scheduled(ws.id, owner.id, new Date(Date.now() - 25 * 3_600_000));
    const recent = await scheduled(ws.id, owner.id, new Date(Date.now() - 2 * 3_600_000));
    const future = await scheduled(ws.id, owner.id, new Date(Date.now() + 3_600_000));
    await run('reconcile');
    for (const m of [stale]) {
      expect(await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
        status: 'CANCELLED',
        endReason: 'cancelled',
      });
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'meeting.cancel', targetId: m.id },
      });
      expect(audit?.actorId).toBeNull();
    }
    expect(await status(recent.id)).toBe('SCHEDULED');
    expect(await status(future.id)).toBe('SCHEDULED');
  });

  it('đối soát: phòng còn người → giữ LIVE, đóng phiên của người đã rời mà thiếu webhook, giữ phiên mới vào', async () => {
    const owner = await user('owner');
    const stayer = await user('stayer');
    const leaver = await user('leaver');
    const justJoined = await user('fresh');
    const ws = await workspace(owner.id, 'COMPANY');
    const m = await live(ws.id, owner.id, minutesAgo(30));
    media.rooms.set(roomNameFor(m.id), {
      metadata: '{}',
      participants: [{ identity: stayer.id, joinedAt: minutesAgo(20), hidden: false }],
    });
    await prisma.meetingAttendance.createMany({
      data: [
        { meetingId: m.id, userId: stayer.id, joinedAt: minutesAgo(20) },
        { meetingId: m.id, userId: leaver.id, joinedAt: minutesAgo(15) },
        { meetingId: m.id, userId: justJoined.id, joinedAt: new Date() },
      ],
    });
    await run('reconcile');
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('LIVE');
    const open = async (userId: string) =>
      (
        await prisma.meetingAttendance.findFirstOrThrow({
          where: { meetingId: m.id, userId },
        })
      ).leftAt === null;
    expect(await open(stayer.id)).toBe(true);
    expect(await open(leaver.id)).toBe(false);
    expect(await open(justJoined.id)).toBe(true);
  });

  it('đối soát: buổi họp LIVE quá 12 giờ bị kết thúc dù phòng còn người', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const m = await live(ws.id, owner.id, new Date(Date.now() - 13 * 3_600_000));
    media.rooms.set(roomNameFor(m.id), {
      metadata: '{}',
      participants: [{ identity: owner.id, joinedAt: new Date(), hidden: false }],
    });
    await run('reconcile');
    expect(await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({
      status: 'ENDED',
      endReason: 'empty',
    });
  });

  it('đối soát: một phòng lỗi không chặn các phòng khác', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const broken = await live(ws.id, owner.id, minutesAgo(10));
    const gone = await live(ws.id, owner.id, minutesAgo(10));
    const original = media.listParticipants.bind(media);
    media.listParticipants = async (roomName: string) => {
      if (roomName === roomNameFor(broken.id)) throw new Error('livekit timeout');
      return original(roomName);
    };
    try {
      await run('reconcile');
    } finally {
      media.listParticipants = original;
    }
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: broken.id } })).status).toBe(
      'LIVE',
    );
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: gone.id } })).status).toBe(
      'ENDED',
    );
  });

  it('nhắc bỏ qua người tạo và người được mời đã bị vô hiệu hoá, ở cả COMPANY và TEAM', async () => {
    const at = new Date(Date.now() + 3_600_000);
    const activeOwner = await user('owner');
    const team = await workspace(activeOwner.id, 'TEAM');
    const company = await workspace(activeOwner.id, 'COMPANY');
    for (const ws of [team, company]) {
      const disabledCreator = await user('dcreator', 'DISABLED');
      const disabledInvitee = await user('dinvitee', 'DISABLED');
      const okInvitee = await user('okinvitee');
      const m = await scheduled(ws.id, disabledCreator.id, at);
      await prisma.meetingInvite.createMany({
        data: [
          { meetingId: m.id, userId: disabledInvitee.id },
          { meetingId: m.id, userId: okInvitee.id },
        ],
      });
      await run('remind', { meetingId: m.id, scheduledAt: at.toISOString() });
      expect(await reminded(m.id)).toEqual([okInvitee.id]);
    }
  });

  it('nhắc muộn (đã quá giờ họp) thì không gửi', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const at = new Date(Date.now() - 60_000);
    const m = await scheduled(ws.id, owner.id, at);
    await run('remind', { meetingId: m.id, scheduledAt: at.toISOString() });
    expect(await reminded(m.id)).toEqual([]);
  });

  it('đối soát: kiểm tra lại ngay trước khi kết thúc, phòng có người trở lại thì giữ LIVE', async () => {
    const owner = await user('owner');
    const ws = await workspace(owner.id, 'COMPANY');
    const m = await live(ws.id, owner.id, minutesAgo(10));
    const original = media.listParticipants.bind(media);
    let calls = 0;
    media.listParticipants = async (roomName: string) => {
      if (roomName !== roomNameFor(m.id)) return original(roomName);
      calls++;
      return calls === 1 ? null : [{ identity: owner.id, joinedAt: new Date(), hidden: false }];
    };
    try {
      await run('reconcile');
    } finally {
      media.listParticipants = original;
    }
    expect(calls).toBe(2);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('LIVE');
  });

  it('khởi động đăng ký job scheduler đối soát mỗi 60 giây', async () => {
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.find((s) => s.key === 'reconcile')).toMatchObject({
      name: 'reconcile',
      every: 60_000,
    });
  });
});
