import request from 'supertest';
import {
  createTestApp,
  loginAs,
  cookiePair,
  resetDatabase,
  setCookies,
  type TestContext,
} from './create-test-app.js';
import { companyClaims } from './fake-google-identity.js';

const MINUTE = 60_000;

describe('Auth (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function startLogin() {
    const agent = request.agent(ctx.app.getHttpServer());
    const res = await agent.get('/api/v1/auth/google').set('Host', 'localhost:4000').expect(302);
    return { agent, res, state: new URL(res.headers.location!).searchParams.get('state')! };
  }

  async function callbackError(email: string, overrides = {}) {
    const { agent, state } = await startLogin();
    ctx.google.nextClaims = companyClaims(email, overrides);
    const res = await agent
      .get('/api/v1/auth/google/callback')
      .query({ code: 'c', state })
      .expect(302);
    return new URL(res.headers.location!).searchParams.get('error');
  }

  describe('Google login', () => {
    it('mở từ host khác host callback (127.0.0.1) → chuyển sang host callback trước khi đặt cookie state', async () => {
      const viaProxy = await request(ctx.app.getHttpServer())
        .get('/api/v1/auth/google')
        .set('Host', 'localhost:4000')
        .set('X-Forwarded-Host', '127.0.0.1:5173')
        .expect(302);
      expect(viaProxy.headers.location).toBe('http://localhost:4000/api/v1/auth/google');
      expect(viaProxy.headers['set-cookie']).toBeUndefined();
      const direct = await request(ctx.app.getHttpServer())
        .get('/api/v1/auth/google')
        .set('Host', '127.0.0.1:4000')
        .expect(302);
      expect(direct.headers.location).toBe('http://localhost:4000/api/v1/auth/google');
      const same = await request(ctx.app.getHttpServer())
        .get('/api/v1/auth/google')
        .set('Host', 'localhost:4000')
        .set('X-Forwarded-Host', 'localhost:5173')
        .expect(302);
      expect(same.headers.location).toContain('https://accounts.google.test/');
      expect(String(same.headers['set-cookie'])).toContain('luna_oauth_state=');
    });

    it('chuyển hướng sang Google và đặt cookie state (SameSite=Lax)', async () => {
      const { res, state } = await startLogin();
      expect(state).toBeTruthy();
      const cookie = setCookies(res).find((c) => c.startsWith('luna_oauth_state='));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it('callback thành công: tạo user, đặt session cookie không có hạn, chuyển về FE', async () => {
      const { agent, state } = await startLogin();
      ctx.google.nextClaims = companyClaims('new.user@lunatech.vn', { name: 'New User' });
      const res = await agent
        .get('/api/v1/auth/google/callback')
        .query({ code: 'c', state })
        .expect(302);

      expect(res.headers.location).toBe('http://localhost:5173/auth/done');
      const cookie = setCookies(res).find((c) => c.startsWith('luna_rt='))!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookie).not.toMatch(/Expires=|Max-Age=/i);

      const user = await ctx.prisma.user.findUnique({ where: { email: 'new.user@lunatech.vn' } });
      expect(user).toMatchObject({ name: 'New User', status: 'ACTIVE', isSystemAdmin: false });
      expect(user!.lastLoginAt).toBeInstanceOf(Date);
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { actorId: user!.id, action: 'auth.login' },
      });
      expect(audit).not.toBeNull();
    });

    it('từ chối email ngoài domain công ty', async () => {
      expect(await callbackError('someone@gmail.com', { hostedDomain: undefined })).toBe(
        'DOMAIN_NOT_ALLOWED',
      );
      expect(await callbackError('x@other.vn')).toBe('DOMAIN_NOT_ALLOWED');
      expect(await ctx.prisma.user.count({ where: { email: 'someone@gmail.com' } })).toBe(0);
      const failed = await ctx.prisma.auditLog.count({ where: { action: 'auth.login_failed' } });
      expect(failed).toBeGreaterThanOrEqual(2);
    });

    it('từ chối khi claim hd không khớp dù email đúng đuôi', async () => {
      expect(await callbackError('trick@lunatech.vn', { hostedDomain: undefined })).toBe(
        'DOMAIN_NOT_ALLOWED',
      );
    });

    it('từ chối email chưa xác minh', async () => {
      expect(await callbackError('unverified@lunatech.vn', { emailVerified: false })).toBe(
        'EMAIL_NOT_VERIFIED',
      );
    });

    it('từ chối tài khoản bị khóa', async () => {
      await ctx.prisma.user.create({
        data: { email: 'locked@lunatech.vn', name: 'Locked', status: 'DISABLED' },
      });
      expect(await callbackError('locked@lunatech.vn')).toBe('ACCOUNT_DISABLED');
    });

    it('từ chối state không khớp cookie', async () => {
      const { agent } = await startLogin();
      ctx.google.nextClaims = companyClaims('a@lunatech.vn');
      const res = await agent
        .get('/api/v1/auth/google/callback')
        .query({ code: 'c', state: 'forged-state' })
        .expect(302);
      expect(new URL(res.headers.location!).searchParams.get('error')).toBe('INVALID_STATE');
    });

    it('không dùng lại được state (chống replay callback)', async () => {
      const { agent, state } = await startLogin();
      ctx.google.nextClaims = companyClaims('replay@lunatech.vn');
      await agent.get('/api/v1/auth/google/callback').query({ code: 'c', state }).expect(302);
      const res = await http()
        .get('/api/v1/auth/google/callback')
        .set('Cookie', `luna_oauth_state=${state}`)
        .query({ code: 'c', state })
        .expect(302);
      expect(new URL(res.headers.location!).searchParams.get('error')).toBe('INVALID_STATE');
    });

    it('người dùng hủy ở Google → ACCESS_DENIED', async () => {
      const { agent, state } = await startLogin();
      const res = await agent
        .get('/api/v1/auth/google/callback')
        .query({ error: 'access_denied', state })
        .expect(302);
      expect(new URL(res.headers.location!).searchParams.get('error')).toBe('ACCESS_DENIED');
    });

    it('user được thêm trước (pre-provision) nhận tên thật khi đăng nhập lần đầu', async () => {
      await ctx.prisma.user.create({ data: { email: 'pre@lunatech.vn', name: 'pre' } });
      await loginAs(ctx, 'pre@lunatech.vn', { name: 'Nguyễn Văn Pre' });
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'pre@lunatech.vn' } });
      expect(user.name).toBe('Nguyễn Văn Pre');
    });
  });

  describe('Access token và phiên', () => {
    it('refresh trả access token dùng được cho /me', async () => {
      const { auth } = await loginAs(ctx, 'me@lunatech.vn');
      const res = await http().get('/api/v1/me').set(auth).expect(200);
      expect(res.body).toMatchObject({
        email: 'me@lunatech.vn',
        isSystemAdmin: false,
        workspaces: [],
      });
    });

    it('token sai chữ ký bị từ chối', async () => {
      const { accessToken } = await loginAs(ctx, 'sig@lunatech.vn');
      const tampered = accessToken.slice(0, -4) + 'AAAA';
      const res = await http().get('/api/v1/me').set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('refresh xoay vòng token; dùng lại token cũ sau grace period thu hồi cả phiên', async () => {
      const { agent, userId } = await loginAs(ctx, 'rotate@lunatech.vn');
      const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId } });
      const stolenCookie = cookiePair(
        await agent.post('/api/v1/auth/refresh').expect(200),
        'luna_rt',
      )!;
      await agent.post('/api/v1/auth/refresh').expect(200);
      expect(
        await ctx.prisma.refreshToken.count({ where: { sessionId: session.id, rotatedAt: null } }),
      ).toBe(1);

      await ctx.prisma.refreshToken.updateMany({
        where: { sessionId: session.id, rotatedAt: { not: null } },
        data: { rotatedAt: new Date(Date.now() - MINUTE) },
      });
      const reuse = await http().post('/api/v1/auth/refresh').set('Cookie', stolenCookie);
      expect(reuse.status).toBe(401);
      expect(reuse.body.error).toMatchObject({
        code: 'SESSION_EXPIRED',
        details: { reason: 'refresh_token_reuse' },
      });

      await agent.post('/api/v1/auth/refresh').expect(401);
      const revoked = await ctx.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(revoked.revokedReason).toBe('refresh_token_reuse');
    });

    it('hai tab refresh cùng lúc (trong grace period) không bị coi là tấn công', async () => {
      const { agent } = await loginAs(ctx, 'tabs@lunatech.vn');
      const cookie = cookiePair(await agent.post('/api/v1/auth/refresh').expect(200), 'luna_rt')!;
      await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);
      const second = await http().post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(second.status).toBe(200);
      expect(cookiePair(second, 'luna_rt')).toBeUndefined();
    });

    it('idle quá 60 phút → SESSION_EXPIRED, phải đăng nhập lại', async () => {
      const { agent, auth, userId } = await loginAs(ctx, 'idle@lunatech.vn');
      await ctx.prisma.session.updateMany({
        where: { userId },
        data: { lastSeenAt: new Date(Date.now() - 61 * MINUTE) },
      });
      const res = await http().get('/api/v1/me').set(auth).expect(401);
      expect(res.body.error).toMatchObject({
        code: 'SESSION_EXPIRED',
        details: { reason: 'idle_timeout' },
      });
      await agent.post('/api/v1/auth/refresh').expect(401);
    });

    it('vượt 12 giờ kể từ lúc đăng nhập → SESSION_EXPIRED dù vẫn hoạt động', async () => {
      const { agent, auth, userId } = await loginAs(ctx, 'absolute@lunatech.vn');
      await ctx.prisma.session.updateMany({
        where: { userId },
        data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
      });
      const res = await http().get('/api/v1/me').set(auth).expect(401);
      expect(res.body.error.details.reason).toBe('absolute_timeout');
      await agent.post('/api/v1/auth/refresh').expect(401);
    });

    it('request thật cập nhật last_seen_at (giữ phiên khi đang dùng)', async () => {
      const { auth, userId } = await loginAs(ctx, 'active@lunatech.vn');
      const old = new Date(Date.now() - 30 * MINUTE);
      await ctx.prisma.session.updateMany({ where: { userId }, data: { lastSeenAt: old } });
      await http().get('/api/v1/me').set(auth).expect(200);
      const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId } });
      expect(session.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
    });

    it('đăng xuất thu hồi phiên và xóa cookie', async () => {
      const { agent, auth } = await loginAs(ctx, 'logout@lunatech.vn');
      const res = await agent.post('/api/v1/auth/logout').set(auth).expect(204);
      expect(setCookies(res).some((c) => c.startsWith('luna_rt=;'))).toBe(true);
      await http().get('/api/v1/me').set(auth).expect(401);
      await agent.post('/api/v1/auth/refresh').expect(204);
    });

    it('refresh không có cookie (chưa đăng nhập) → 204, không phải lỗi', async () => {
      const res = await http().post('/api/v1/auth/refresh').expect(204);
      expect(res.text).toBe('');
    });
  });
});
