import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { ParticipantKind, RoomEvent, TrackKind, TrackSource } from '@livekit/rtc-node';
import { createPrismaClient, type PrismaClient } from '@luna/db';
import { encodeRoomMetadata, MEETING_MEDIA } from '@luna/meetings';
import { FakeMeetingMedia } from '@luna/meetings/testing';
import {
  createS3Client,
  enqueueMinutes,
  ensureBuckets,
  loadEnv,
  QUEUES,
  redisConnection,
  s3EnvSchema,
} from '@luna/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { RecorderHooks, RoomLike } from '../src/recording-session.js';
import { TrackRecorder } from '../src/track-recorder.js';

const FRAME_MS = 20;
const SAMPLES = FRAME_MS * 16;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => new Promise((resolve) => setImmediate(resolve));

class FrameQueue implements AsyncIterable<{ data: Int16Array }> {
  private readonly items: Array<{ data: Int16Array } | null> = [];
  private waiter?: () => void;

  push(frame: { data: Int16Array } | null) {
    this.items.push(frame);
    this.waiter?.();
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      while (this.items.length === 0) await new Promise<void>((r) => (this.waiter = r));
      const next = this.items.shift()!;
      if (next === null) return;
      yield next;
    }
  }
}

interface FakePublication {
  kind: TrackKind;
  source: TrackSource;
  subscribedCalls: boolean[];
  setSubscribed(value: boolean): void;
  queue: FrameQueue;
}

class FakeRoom extends EventEmitter implements RoomLike {
  readonly remoteParticipants = new Map<
    string,
    { identity: string; kind: ParticipantKind; trackPublications: Map<string, FakePublication> }
  >();
  metadata: string | undefined;
  disconnected = false;

  constructor(metadata: string) {
    super();
    this.metadata = metadata;
  }

  join(identity: string, opts: { kind?: ParticipantKind; sources?: TrackSource[] } = {}) {
    const trackPublications = new Map<string, FakePublication>();
    const participant = {
      identity,
      kind: opts.kind ?? ParticipantKind.STANDARD,
      trackPublications,
    };
    const sources = opts.sources ?? [TrackSource.SOURCE_MICROPHONE];
    for (const source of sources) {
      const subscribedCalls: boolean[] = [];
      trackPublications.set(`${identity}-${source}`, {
        kind: source === TrackSource.SOURCE_CAMERA ? TrackKind.KIND_VIDEO : TrackKind.KIND_AUDIO,
        source,
        subscribedCalls,
        setSubscribed: (v) => subscribedCalls.push(v),
        queue: new FrameQueue(),
      });
    }
    this.remoteParticipants.set(identity, participant);
    this.emit(RoomEvent.ParticipantConnected, participant);
    return participant;
  }

  mic(identity: string): FakePublication {
    return this.remoteParticipants
      .get(identity)!
      .trackPublications.get(`${identity}-${TrackSource.SOURCE_MICROPHONE}`)!;
  }

  deliverMic(identity: string) {
    const participant = this.remoteParticipants.get(identity)!;
    const publication = this.mic(identity);
    this.emit(RoomEvent.TrackSubscribed, publication.queue, publication, participant);
  }

  leave(identity: string) {
    const participant = this.remoteParticipants.get(identity)!;
    this.remoteParticipants.delete(identity);
    this.emit(RoomEvent.ParticipantDisconnected, participant);
  }

  unpublishMic(identity: string) {
    const participant = this.remoteParticipants.get(identity)!;
    const publication = this.mic(identity);
    participant.trackPublications.delete(`${identity}-${TrackSource.SOURCE_MICROPHONE}`);
    this.emit(RoomEvent.TrackUnpublished, publication, participant);
  }

  setMetadata(metadata: string) {
    this.metadata = metadata;
    this.emit(RoomEvent.RoomMetadataChanged, metadata);
  }

  async disconnect() {
    this.disconnected = true;
  }
}

describe('Recording session (e2e)', () => {
  const containers: StartedTestContainer[] = [];
  let app: INestApplicationContext;
  let prisma: PrismaClient;
  let s3: ReturnType<typeof createS3Client>;
  let minutesQueue: Queue;
  let media: FakeMeetingMedia;
  let session: import('../src/recording-session.js').RecordingSession;
  let hooks: RecorderHooks;
  let seq = 0;
  let clock = 0;
  let bucket: string;
  let dbUri: string;
  let appClosed = false;

  const startedAt = new Date('2026-11-03T03:00:00.000Z');

  const newUser = () =>
    prisma.user.create({ data: { email: `rec${++seq}@lunatech.vn`, name: `Rec ${seq}` } });
  const newMeeting = async (opts: { aiNotesEnabled?: boolean } = {}) => {
    const owner = await newUser();
    const workspace = await prisma.workspace.create({
      data: { name: `W${++seq}`, slug: `rec-w${seq}`, createdById: owner.id },
    });
    const meeting = await prisma.meeting.create({
      data: {
        workspaceId: workspace.id,
        createdById: owner.id,
        title: 'Recorded',
        status: 'LIVE',
        startedAt,
        aiNotesEnabled: opts.aiNotesEnabled ?? true,
      },
    });
    return { meeting, owner };
  };
  const roomMeta = (hostId: string, aiNotesEnabled: boolean) =>
    encodeRoomMetadata({ title: 'Recorded', aiNotesEnabled, hostId });

  const useRoom = (room: FakeRoom) => {
    hooks.connectRoom = async () => room;
  };
  const speak = async (queue: FrameQueue, fromMs: number, durationMs: number, loud: boolean) => {
    const frame = () => ({ data: new Int16Array(SAMPLES).fill(loud ? 3000 : 0) });
    for (let t = fromMs; t < fromMs + durationMs; t += FRAME_MS) {
      clock = startedAt.getTime() + t + FRAME_MS;
      queue.push(frame());
      await tick();
    }
  };
  const chunksOf = (meetingId: string) =>
    prisma.meetingAudioChunk.findMany({ where: { meetingId }, orderBy: { startOffsetMs: 'asc' } });
  const waitUntil = async (fn: () => Promise<boolean>, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return;
      await sleep(50);
    }
    throw new Error('waitUntil timed out');
  };

  beforeAll(async () => {
    const [pg, redis, minio] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('pgsty/minio:RELEASE.2026-08-04T00-00-00Z')
        .withCommand(['server', '/data'])
        .withEnvironment({ MINIO_ROOT_USER: 'r_minio', MINIO_ROOT_PASSWORD: 'r_minio_password' })
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
        .start(),
    ]);
    containers.push(pg, redis, minio);
    dbUri = pg.getConnectionUri();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      RECORDER_METRICS_PORT: '0',
      LOG_LEVEL: 'warn',
      DATABASE_URL: pg.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
      S3_ENDPOINT: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
      S3_ACCESS_KEY: 'r_minio',
      S3_SECRET_KEY: 'r_minio_password',
      S3_FORCE_PATH_STYLE: 'true',
      S3_BUCKET_TMP: 'r-tmp',
      S3_BUCKET_HLS: 'r-hls',
      S3_BUCKET_PREVIEWS: 'r-previews',
      S3_BUCKET_THUMBNAILS: 'r-thumbnails',
      S3_BUCKET_ASSETS: 'r-assets',
      S3_BUCKET_ORIGINALS: 'r-originals',
      S3_BUCKET_MEETING_AUDIO: 'r-meeting-audio',
      LIVEKIT_URL: 'wss://fake.livekit.test',
      LIVEKIT_API_KEY: 'fake-livekit-key',
      LIVEKIT_API_SECRET: 'fake-livekit-secret-0123456789abcdef',
      MEETING_EMPTY_GRACE_SEC: '30',
      RECORDER_TMP_DIR: mkdtempSync(join(tmpdir(), 'luna-recorder-test-')),
    });
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: fileURLToPath(new URL('../../../packages/db', import.meta.url)),
      env: process.env,
      stdio: 'pipe',
    });
    const s3Env = loadEnv(s3EnvSchema, process.env);
    s3 = createS3Client(s3Env);
    await ensureBuckets(s3, s3Env);
    bucket = s3Env.S3_BUCKET_MEETING_AUDIO;

    media = new FakeMeetingMedia();
    hooks = { now: () => clock, pollMs: 50, openAudio: (track) => track as FrameQueue };
    const { RecorderModule } = await import('../src/recorder.module.js');
    const { RECORDER_HOOKS, RecordingSession } = await import('../src/recording-session.js');
    const { PrismaService } = await import('../src/prisma.provider.js');
    app = await (
      await Test.createTestingModule({ imports: [RecorderModule] })
        .overrideProvider(MEETING_MEDIA)
        .useValue(media)
        .overrideProvider(RECORDER_HOOKS)
        .useValue(hooks)
        .compile()
    ).init();
    session = app.get(RecordingSession);
    prisma = app.get(PrismaService).client;
    minutesQueue = new Queue(QUEUES.MEETING_MINUTES, {
      connection: redisConnection(process.env.REDIS_URL!),
      prefix: 'luna',
    });
  }, 180_000);

  afterAll(async () => {
    await minutesQueue?.close();
    if (!appClosed) await app?.close();
    s3?.destroy();
    await Promise.all(containers.map((c) => c.stop()));
  });

  it('ensureBuckets đặt vòng đời bucket âm thanh: hết hạn sau số ngày giữ cộng 7, theo cấu hình', async () => {
    const rulesOf = async () =>
      (await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))).Rules ?? [];
    expect(await rulesOf()).toEqual([
      expect.objectContaining({ ID: 'expire-meeting-audio', Expiration: { Days: 14 } }),
    ]);
    const s3Env = loadEnv(s3EnvSchema, process.env);
    await ensureBuckets(s3, { ...s3Env, MEETING_AUDIO_RETENTION_DAYS: 3 });
    expect((await rulesOf())[0]!.Expiration).toEqual({ Days: 10 });
    await ensureBuckets(s3, s3Env);
    expect((await rulesOf())[0]!.Expiration).toEqual({ Days: 14 });
    const tmp = await s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: s3Env.S3_BUCKET_TMP }),
    );
    expect(tmp.Rules?.[0]?.ID).toBe('expire-tmp');
  });

  it('phiên ghi: chỉ đăng ký mic, không đăng ký camera và màn hình; bỏ qua participant ẩn', async () => {
    const { meeting, owner } = await newMeeting();
    const alice = await newUser();
    const hiddenBot = await newUser();
    const room = new FakeRoom(roomMeta(owner.id, true));
    room.join(alice.id, {
      sources: [
        TrackSource.SOURCE_MICROPHONE,
        TrackSource.SOURCE_CAMERA,
        TrackSource.SOURCE_SCREENSHARE,
        TrackSource.SOURCE_SCREENSHARE_AUDIO,
      ],
    });
    room.join('luna-recorder');
    room.join(hiddenBot.id, { kind: ParticipantKind.EGRESS });
    useRoom(room);
    const abort = new AbortController();
    const running = session.run(meeting.id, abort.signal);
    await waitUntil(async () => room.mic(alice.id).subscribedCalls.length > 0);
    const aliceTracks = [...room.remoteParticipants.get(alice.id)!.trackPublications.values()];
    expect(aliceTracks.filter((p) => p.subscribedCalls.length > 0).map((p) => p.source)).toEqual([
      TrackSource.SOURCE_MICROPHONE,
    ]);
    expect(room.mic('luna-recorder').subscribedCalls).toEqual([]);
    expect(room.mic(hiddenBot.id).subscribedCalls).toEqual([]);
    expect(media.tokens.at(-1)).toMatchObject({ role: 'recorder', identity: 'luna-recorder' });
    abort.abort();
    await expect(running).rejects.toThrow('interrupted');
    expect(room.disconnected).toBe(true);
  });

  it('phiên ghi: chủ trì tắt ghi biên bản giữa chừng → không có đoạn nào trong khoảng tắt', async () => {
    const { meeting, owner } = await newMeeting();
    const alice = await newUser();
    const room = new FakeRoom(roomMeta(owner.id, true));
    room.join(alice.id);
    useRoom(room);
    const abort = new AbortController();
    const running = session.run(meeting.id, abort.signal);
    await waitUntil(async () => room.mic(alice.id).subscribedCalls.length > 0);
    room.deliverMic(alice.id);
    const queue = room.mic(alice.id).queue;

    await speak(queue, 0, 1000, true);
    await speak(queue, 1000, 2000, false);
    await waitUntil(async () => (await chunksOf(meeting.id)).length === 1);

    await prisma.meeting.update({ where: { id: meeting.id }, data: { aiNotesEnabled: false } });
    await sleep(300);
    expect(room.mic(alice.id).subscribedCalls.at(-1)).toBe(false);
    await speak(queue, 4000, 1000, true);
    await speak(queue, 5000, 2000, false);

    await prisma.meeting.update({ where: { id: meeting.id }, data: { aiNotesEnabled: true } });
    room.setMetadata(roomMeta(owner.id, false));
    await sleep(300);
    await speak(queue, 8000, 1000, true);
    await speak(queue, 9000, 2000, false);

    room.setMetadata(roomMeta(owner.id, true));
    await sleep(300);
    expect(room.mic(alice.id).subscribedCalls.at(-1)).toBe(true);
    await speak(queue, 11_000, 1000, false);
    await speak(queue, 12_000, 1000, true);
    await speak(queue, 13_000, 2000, false);
    await waitUntil(async () => (await chunksOf(meeting.id)).length === 2);

    const chunks = await chunksOf(meeting.id);
    expect(chunks.map((c) => c.startOffsetMs)).toEqual([0, 11_700]);
    expect(chunks.every((c) => c.container === bucket && c.userId === alice.id)).toBe(true);
    abort.abort();
    await expect(running).rejects.toThrow('interrupted');
  });

  it('phiên ghi: bot chạy lại sau khi chết không tạo đoạn trùng offset', async () => {
    const { meeting, owner } = await newMeeting();
    const alice = await newUser();
    const record = async () => {
      const room = new FakeRoom(roomMeta(owner.id, true));
      room.join(alice.id);
      useRoom(room);
      const abort = new AbortController();
      const running = session.run(meeting.id, abort.signal);
      await waitUntil(async () => room.mic(alice.id).subscribedCalls.length > 0);
      room.deliverMic(alice.id);
      await speak(room.mic(alice.id).queue, 0, 1000, true);
      await speak(room.mic(alice.id).queue, 1000, 2000, false);
      await sleep(500);
      abort.abort();
      await expect(running).rejects.toThrow('interrupted');
    };
    await record();
    expect(await chunksOf(meeting.id)).toHaveLength(1);
    await record();
    const chunks = await chunksOf(meeting.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startOffsetMs).toBe(0);
    expect(
      await prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } }),
    ).toMatchObject({ status: 'RECORDING', audioCompletedAt: null });
  });

  it('phiên ghi: buổi họp kết thúc → đặt audioCompletedAt và đẩy job biên bản chạy ngay', async () => {
    const { meeting, owner } = await newMeeting();
    const alice = await newUser();
    await enqueueMinutes(minutesQueue as never, meeting.id, { delayMs: 3_600_000 });
    const delayed = await minutesQueue.getJob(`minutes-${meeting.id}`);
    expect(await delayed!.isDelayed()).toBe(true);

    const room = new FakeRoom(roomMeta(owner.id, true));
    room.join(alice.id);
    useRoom(room);
    const running = session.run(meeting.id, new AbortController().signal);
    await waitUntil(async () => room.mic(alice.id).subscribedCalls.length > 0);
    room.deliverMic(alice.id);
    const queue = room.mic(alice.id).queue;
    await speak(queue, 0, 1500, true);
    await speak(queue, 1500, 500, false);

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await expect(running).resolves.toBe('ended');

    const minutes = await prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } });
    expect(minutes?.audioCompletedAt).toBeInstanceOf(Date);
    expect(minutes?.audioPurgeAfter?.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const chunks = await chunksOf(meeting.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.durationMs).toBeGreaterThanOrEqual(1500);
    expect(room.disconnected).toBe(true);
    const promoted = await minutesQueue.getJob(`minutes-${meeting.id}`);
    expect(await promoted!.isDelayed()).toBe(false);
    expect(await promoted!.isWaiting()).toBe(true);

    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: chunks[0]!.key }));
    const bytes = await object.Body!.transformToByteArray();
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe('OggS');
    expect(BigInt(bytes.length)).toBe(chunks[0]!.sizeBytes);
  });

  it('phiên ghi: phòng không còn người thật quá thời gian chờ → kết thúc, không có lời nói', async () => {
    const { meeting, owner } = await newMeeting();
    const room = new FakeRoom(roomMeta(owner.id, true));
    useRoom(room);
    clock = startedAt.getTime();
    const running = session.run(meeting.id, new AbortController().signal);
    await sleep(300);
    clock += 31_000;
    await expect(running).resolves.toBe('empty');
    expect(await chunksOf(meeting.id)).toHaveLength(0);
    expect(
      (await prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } }))
        ?.audioCompletedAt,
    ).toBeNull();
    expect(await minutesQueue.getJob(`minutes-${meeting.id}`)).toBeUndefined();
  });

  it('phiên ghi: phòng trống nhưng buổi họp còn LIVE → không đẩy job biên bản, không đặt audioCompletedAt', async () => {
    const { meeting, owner } = await newMeeting();
    const alice = await newUser();
    const room = new FakeRoom(roomMeta(owner.id, true));
    room.join(alice.id);
    useRoom(room);
    clock = startedAt.getTime();
    const running = session.run(meeting.id, new AbortController().signal);
    await waitUntil(async () => room.mic(alice.id).subscribedCalls.length > 0);
    room.deliverMic(alice.id);
    await speak(room.mic(alice.id).queue, 0, 1000, true);
    await speak(room.mic(alice.id).queue, 1000, 2000, false);
    room.leave(alice.id);
    await sleep(200);
    clock += 31_000;
    await expect(running).resolves.toBe('ended');
    expect(
      (await prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } }))
        ?.audioCompletedAt,
    ).toBeNull();
    expect(await minutesQueue.getJob(`minutes-${meeting.id}`)).toBeUndefined();
  });

  it('phiên ghi: mốc 6 giờ tính từ lần mất kết nối đầu tiên, không phải từ lúc bắt đầu buổi họp', async () => {
    const { meeting, owner } = await newMeeting();
    const drop = async (at: number) => {
      const room = new FakeRoom(roomMeta(owner.id, true));
      useRoom(room);
      clock = at;
      const running = session.run(meeting.id, new AbortController().signal).catch((e) => e);
      await sleep(250);
      room.emit(RoomEvent.Disconnected);
      return (await running) as Error;
    };
    const first = startedAt.getTime() + 8 * 3_600_000;
    expect((await drop(first)).message).toContain('disconnected');
    expect((await drop(first + 3_600_000)).message).toContain('disconnected');
    expect((await drop(first + 6 * 3_600_000 + 1000)).message).toContain('kept losing');
  });

  it('phiên ghi: kết nối ổn định đủ lâu thì mốc 6 giờ được tính lại', async () => {
    const { meeting, owner } = await newMeeting();
    const alice = await newUser();
    const first = startedAt.getTime() + 8 * 3_600_000;
    const room1 = new FakeRoom(roomMeta(owner.id, true));
    useRoom(room1);
    clock = first;
    const run1 = session.run(meeting.id, new AbortController().signal).catch((e) => e);
    await sleep(250);
    room1.emit(RoomEvent.Disconnected);
    expect(((await run1) as Error).message).toContain('disconnected');

    const room2 = new FakeRoom(roomMeta(owner.id, true));
    room2.join(alice.id);
    useRoom(room2);
    clock = first + 60_000;
    const abort = new AbortController();
    const run2 = session.run(meeting.id, abort.signal);
    await sleep(250);
    clock = first + 60_000 + 10 * 60_000;
    await sleep(250);
    abort.abort();
    await expect(run2).rejects.toThrow('interrupted');

    const room3 = new FakeRoom(roomMeta(owner.id, true));
    useRoom(room3);
    clock = first + 7 * 3_600_000;
    const run3 = session.run(meeting.id, new AbortController().signal).catch((e) => e);
    await sleep(250);
    room3.emit(RoomEvent.Disconnected);
    expect(((await run3) as Error).message).toContain('disconnected');
  });

  it('phiên ghi: setSubscribed lỗi không làm hỏng phiên; người rời phòng hoặc gỡ mic bị bỏ khỏi danh sách đăng ký', async () => {
    const { meeting, owner } = await newMeeting();
    const [alice, bob, carol, dave] = [
      await newUser(),
      await newUser(),
      await newUser(),
      await newUser(),
    ];
    const room = new FakeRoom(roomMeta(owner.id, true));
    room.join(alice.id);
    const aliceMic = room.mic(alice.id);
    const record = aliceMic.setSubscribed;
    let thrown = false;
    aliceMic.setSubscribed = (value) => {
      if (!thrown) {
        thrown = true;
        throw new Error('setSubscribed boom');
      }
      record(value);
    };
    useRoom(room);
    const abort = new AbortController();
    let failure: unknown;
    const running = session.run(meeting.id, abort.signal).catch((e) => (failure = e));
    await sleep(300);
    room.join(bob.id);
    room.join(carol.id);
    room.join(dave.id);
    await waitUntil(async () => room.mic(dave.id).subscribedCalls.length > 0);
    expect(failure).toBeUndefined();
    expect(room.mic(bob.id).subscribedCalls).toEqual([true]);
    await waitUntil(async () => aliceMic.subscribedCalls.length > 0);
    expect(aliceMic.subscribedCalls).toEqual([true]);

    const carolMic = room.mic(carol.id);
    const daveMic = room.mic(dave.id);
    room.leave(carol.id);
    room.unpublishMic(dave.id);
    await prisma.meeting.update({ where: { id: meeting.id }, data: { aiNotesEnabled: false } });
    await waitUntil(async () => room.mic(bob.id).subscribedCalls.length === 2);
    expect(room.mic(bob.id).subscribedCalls).toEqual([true, false]);
    expect(carolMic.subscribedCalls).toEqual([true]);
    expect(daveMic.subscribedCalls).toEqual([true]);
    expect(failure).toBeUndefined();
    abort.abort();
    await running;
  });

  it('phiên ghi: metadata tắt ghi → pause từng recorder ngay trong cùng lượt xử lý sự kiện', async () => {
    const { meeting, owner } = await newMeeting();
    const alice = await newUser();
    const room = new FakeRoom(roomMeta(owner.id, true));
    room.join(alice.id);
    useRoom(room);
    const abort = new AbortController();
    const running = session.run(meeting.id, abort.signal);
    await waitUntil(async () => room.mic(alice.id).subscribedCalls.length > 0);
    room.deliverMic(alice.id);
    await sleep(100);
    const pause = vi.spyOn(TrackRecorder.prototype, 'pause');
    try {
      room.setMetadata(roomMeta(owner.id, false));
      expect(pause).toHaveBeenCalledTimes(1);
    } finally {
      pause.mockRestore();
    }
    abort.abort();
    await expect(running).rejects.toThrow('interrupted');
  });
  it('phiên ghi: ghi biên bản tắt suốt buổi họp → không có dòng meeting_minutes, không có job biên bản, không đăng ký mic', async () => {
    const { meeting, owner } = await newMeeting({ aiNotesEnabled: false });
    const alice = await newUser();
    const room = new FakeRoom(roomMeta(owner.id, false));
    room.join(alice.id);
    useRoom(room);
    const running = session.run(meeting.id, new AbortController().signal);
    await sleep(400);
    room.deliverMic(alice.id);
    await speak(room.mic(alice.id).queue, 0, 1000, true);
    await speak(room.mic(alice.id).queue, 1000, 2000, false);
    expect(room.mic(alice.id).subscribedCalls).toEqual([]);
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await expect(running).resolves.toBe('disabled');
    expect(await prisma.meetingMinutes.findUnique({ where: { meetingId: meeting.id } })).toBeNull();
    expect(await chunksOf(meeting.id)).toHaveLength(0);
    expect(await minutesQueue.getJob(`minutes-${meeting.id}`)).toBeUndefined();
  });

  it('phiên ghi: lỗi kết nối phòng chỉ báo thông điệp cố định, không lộ URL hay token', async () => {
    const { meeting } = await newMeeting();
    hooks.connectRoom = async (url, token) => {
      throw new Error(`boom ${url} ${token}`);
    };
    const error = await session.run(meeting.id, new AbortController().signal).catch((e) => e);
    expect(error.message).toBe('Could not connect the recorder to the LiveKit room');
  });

  it('đóng ứng dụng khi đang có đoạn mở: chờ phiên ghi xong, đoạn được lưu', async () => {
    const { meeting, owner } = await newMeeting();
    const alice = await newUser();
    const room = new FakeRoom(roomMeta(owner.id, true));
    room.join(alice.id);
    useRoom(room);
    const { RecorderProcessor } = await import('../src/recorder.processor.js');
    const processor = app.get(RecorderProcessor);
    const job = {
      name: 'record',
      data: { meetingId: meeting.id },
      moveToDelayed: async () => undefined,
    };
    const processing = processor.process(job as never, 'token').catch((e) => e);
    await waitUntil(async () => room.mic(alice.id).subscribedCalls.length > 0);
    room.deliverMic(alice.id);
    await speak(room.mic(alice.id).queue, 0, 1000, true);
    appClosed = true;
    await app.close();
    expect((await processing).constructor.name).toBe('DelayedError');
    const check = createPrismaClient({ connectionString: dbUri });
    try {
      const rows = await check.meetingAudioChunk.findMany({ where: { meetingId: meeting.id } });
      expect(rows).toHaveLength(1);
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: rows[0]!.key }));
      expect(head.ContentLength).toBeGreaterThan(0);
    } finally {
      await check.$disconnect();
    }
  });
});
