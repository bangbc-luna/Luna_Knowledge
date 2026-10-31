import type { AddressInfo } from 'node:net';
import { COLLAB_ACCESS_CHANNEL, type CollabAccessEvent } from '@luna/shared';
import { Redis } from 'ioredis';
import request from 'supertest';
import {
  createTestApp,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openSse(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  let stopped = false;
  let opened!: () => void;
  const ready = new Promise<void>((r) => (opened = r));
  const timer = setTimeout(() => controller.abort(), 5_000);
  const closed = (async () => {
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (res.status !== 200) throw new Error(`SSE returned ${res.status}`);
      opened();
      const reader = res.body!.getReader();
      while (!(await reader.read()).done) {}
    } catch (err) {
      if (stopped) return;
      throw controller.signal.aborted ? new Error('SSE stream still open after 5s') : err;
    } finally {
      clearTimeout(timer);
    }
  })();
  return {
    closed,
    ready,
    stop: () => {
      stopped = true;
      controller.abort();
    },
  };
}

describe('Thu hồi phiên đăng nhập (e2e)', () => {
  let ctx: TestContext;
  let base: string;
  const streams: Array<{ stop(): void }> = [];
  const sse = (headers: Record<string, string>) => {
    const s = openSse(`${base}/api/v1/me/notifications/stream`, headers);
    streams.push(s);
    return s;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    await ctx.app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(() => {
    streams.splice(0).forEach((s) => s.stop());
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('đăng xuất đóng luồng SSE thông báo của phiên đó', async () => {
    const s1 = await loginAs(ctx, 'sse@lunatech.vn');
    const stream = sse(s1.auth);
    await stream.ready;
    await s1.agent.post('/api/v1/auth/logout').set(s1.auth).expect(204);
    await expect(stream.closed).resolves.toBeUndefined();
  });

  it('đăng xuất một phiên không đóng phiên còn lại', async () => {
    const s1 = await loginAs(ctx, 'two@lunatech.vn');
    const s2 = await loginAs(ctx, 'two@lunatech.vn');
    const mine = sse(s1.auth);
    const other = sse(s2.auth);
    await Promise.all([mine.ready, other.ready]);
    await s1.agent.post('/api/v1/auth/logout').set(s1.auth).expect(204);
    await expect(mine.closed).resolves.toBeUndefined();
    expect(
      await Promise.race([other.closed.then(() => 'closed'), sleep(1500).then(() => 'open')]),
    ).toBe('open');
    await request(ctx.app.getHttpServer()).get('/api/v1/me/notifications').set(s2.auth).expect(200);
  });

  it('đăng xuất phát sự kiện collab kèm userId và sessionId', async () => {
    const s1 = await loginAs(ctx, 'collab@lunatech.vn');
    const session = await ctx.prisma.session.findFirstOrThrow({
      where: { userId: s1.userId, revokedAt: null },
    });
    const sub = new Redis(process.env.REDIS_URL!);
    const events: CollabAccessEvent[] = [];
    sub.on('message', (_c: string, m: string) => events.push(JSON.parse(m) as CollabAccessEvent));
    await sub.subscribe(COLLAB_ACCESS_CHANNEL);
    try {
      await s1.agent.post('/api/v1/auth/logout').set(s1.auth).expect(204);
      const end = Date.now() + 3_000;
      while (events.length === 0 && Date.now() < end) await sleep(50);
      expect(events).toContainEqual({ userId: s1.userId, sessionId: session.id });
    } finally {
      await sub.quit();
    }
  });

  it('khoá tài khoản thu hồi mọi phiên và đóng SSE của từng phiên', async () => {
    const admin = await loginAsAdmin(ctx);
    const a = await loginAs(ctx, 'locked@lunatech.vn');
    const b = await loginAs(ctx, 'locked@lunatech.vn');
    const bystander = await loginAs(ctx, 'bystander@lunatech.vn');
    const sa = sse(a.auth);
    const sb = sse(b.auth);
    const sc = sse(bystander.auth);
    await Promise.all([sa.ready, sb.ready, sc.ready]);
    await request(ctx.app.getHttpServer())
      .patch(`/api/v1/admin/users/${a.userId}`)
      .set(admin.auth)
      .send({ status: 'DISABLED' })
      .expect(200);
    await expect(sa.closed).resolves.toBeUndefined();
    await expect(sb.closed).resolves.toBeUndefined();
    expect(
      await Promise.race([sc.closed.then(() => 'closed'), sleep(1000).then(() => 'open')]),
    ).toBe('open');
    expect(await ctx.prisma.session.count({ where: { userId: a.userId, revokedAt: null } })).toBe(
      0,
    );
  });
});
