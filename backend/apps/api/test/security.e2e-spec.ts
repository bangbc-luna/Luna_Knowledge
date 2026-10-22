import { Redis } from 'ioredis';
import request from 'supertest';
import { APP_CONFIG, loadAppConfig } from '../src/config/app-config.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Bảo mật HTTP (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let bob: LoggedIn;
  const http = () => request(ctx.app.getHttpServer());
  const tag = `${Date.now()}`;

  const clearThrottle = async () => {
    const redis = new Redis(process.env.REDIS_URL!);
    for (const pattern of ['*:hits', '*:blocked']) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    }
    await redis.quit();
  };

  beforeAll(async () => {
    const base = await createTestApp();
    await resetDatabase(base.prisma);
    alice = await loginAs(base, `alice.${tag}@lunatech.vn`);
    bob = await loginAs(base, `bob.${tag}@lunatech.vn`);
    await base.close();
    await clearThrottle();
    const config = {
      ...loadAppConfig(),
      RATE_LIMIT_USER_PER_MIN: 8,
      RATE_LIMIT_ANON_PER_MIN: 4,
      BODY_LIMIT: '2kb',
    };
    ctx = await createTestApp([[APP_CONFIG, config]]);
  });

  afterAll(async () => {
    await ctx?.close();
    await clearThrottle();
  });

  it('header bảo mật của Helmet, không lộ X-Powered-By', async () => {
    const res = await http().get('/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS chỉ trả header cho origin trong danh sách', async () => {
    const ok = await http().get('/health/live').set('Origin', 'http://localhost:5173').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await http().get('/health/live').set('Origin', 'https://evil.example').expect(200);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('cấu hình CORS dạng * bị từ chối khi khởi động', () => {
    expect(() => loadAppConfig({ ...process.env, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('body JSON quá giới hạn → 413', async () => {
    await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .send({ name: 'x'.repeat(4000), slug: 'qua-lon' })
      .expect(413)
      .expect((r) => expect(r.body.error.code).toBe('TOO_LARGE'));
    const bad = await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rate limit theo từng người dùng: người này bị chặn, người khác vẫn dùng được', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++)
      statuses.push((await http().get('/api/v1/me').set(alice.auth)).status);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(8);
    expect(statuses.at(-1)).toBe(429);
    const limited = await http().get('/api/v1/me').set(alice.auth).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await http().get('/api/v1/me').set(bob.auth).expect(200);
  });

  it('request chưa đăng nhập bị giới hạn theo IP; /health không bị giới hạn', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await http().post('/api/v1/auth/refresh')).status);
    expect(statuses).toContain(429);
    for (let i = 0; i < 10; i++) await http().get('/health/live').expect(200);
  });

  it('/metrics: trả số liệu Prometheus cho mạng nội bộ, có METRICS_TOKEN thì bắt buộc token', async () => {
    await http().get('/api/v1/me').set(bob.auth);
    const res = await http().get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toContain('service="api"');
    expect(res.text).toContain('route="/api/v1/me"');

    const token = 'metrics-token-0123456789abcdef';
    const locked = await createTestApp([
      [APP_CONFIG, { ...loadAppConfig(), METRICS_TOKEN: token }],
    ]);
    try {
      const h = () => request(locked.app.getHttpServer());
      await h().get('/metrics').expect(404);
      await h().get('/metrics').set('Authorization', 'Bearer sai-token-0123456789abcd').expect(404);
      await h().get('/metrics').set('Authorization', `Bearer ${token}`).expect(200);
    } finally {
      await locked.close();
    }
  });
});
