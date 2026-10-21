import type { Session, User } from '@luna/db';
import { Inject, Injectable } from '@nestjs/common';
import * as oidc from 'openid-client';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import {
  GOOGLE_IDENTITY,
  type GoogleClaims,
  type GoogleIdentityProvider,
} from './google/google-identity.js';
import { TokenService } from './token.service.js';

export type LoginErrorCode =
  | 'ACCESS_DENIED'
  | 'INVALID_STATE'
  | 'DOMAIN_NOT_ALLOWED'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_DISABLED'
  | 'LOGIN_FAILED';

export class LoginError extends Error {
  constructor(
    readonly code: LoginErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isSystemAdmin: boolean;
}

export interface AuthContext {
  user: AuthenticatedUser;
  sessionId: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthenticatedUser;
}

const REFRESH_GRACE_MS = 10_000;
const TOUCH_INTERVAL_MS = 60_000;
const OAUTH_STATE_TTL_SEC = 600;

type SessionWithUser = Session & { user: User };

export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSystemAdmin: user.isSystemAdmin,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GOOGLE_IDENTITY) private readonly google: GoogleIdentityProvider,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async startGoogleLogin(): Promise<{ url: URL; state: string }> {
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    await this.redis.set(
      this.oauthKey(state),
      JSON.stringify({ nonce, codeVerifier }),
      'EX',
      OAUTH_STATE_TTL_SEC,
    );
    const url = await this.google.buildAuthorizationUrl({
      state,
      nonce,
      codeChallenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    });
    return { url, state };
  }

  async completeGoogleLogin(params: {
    callbackUrl: URL;
    cookieState: string | undefined;
    ctx: RequestContext;
  }): Promise<{ refreshToken: string; user: User }> {
    const { callbackUrl, cookieState, ctx } = params;
    const query = callbackUrl.searchParams;

    if (query.get('error')) {
      throw new LoginError('ACCESS_DENIED', `Google returned error: ${query.get('error')}`);
    }
    const state = query.get('state');
    if (!state || !cookieState || state !== cookieState) {
      throw new LoginError('INVALID_STATE', 'OAuth state mismatch');
    }
    const stored = await this.redis.getdel(this.oauthKey(state));
    if (!stored) throw new LoginError('INVALID_STATE', 'OAuth state expired or already used');
    const { nonce, codeVerifier } = JSON.parse(stored) as { nonce: string; codeVerifier: string };

    let claims: GoogleClaims;
    try {
      claims = await this.google.exchangeCode(callbackUrl, { state, nonce, codeVerifier });
    } catch (err) {
      throw new LoginError('LOGIN_FAILED', `Code exchange failed: ${(err as Error).message}`);
    }

    const email = claims.email.toLowerCase();
    if (!claims.emailVerified) {
      await this.auditLoginFailure(email, 'EMAIL_NOT_VERIFIED', ctx);
      throw new LoginError('EMAIL_NOT_VERIFIED', 'Google email is not verified');
    }
    if (!this.isAllowedGoogleAccount(email, claims.hostedDomain)) {
      await this.auditLoginFailure(email, 'DOMAIN_NOT_ALLOWED', ctx);
      throw new LoginError('DOMAIN_NOT_ALLOWED', `Account ${email} is not allowed`);
    }

    return this.signIn(
      { email, name: claims.name, picture: claims.picture, method: 'google' },
      ctx,
    );
  }

  async signIn(
    profile: { email: string; name?: string; picture?: string; method: 'google' | 'dev' },
    ctx: RequestContext,
  ): Promise<{ refreshToken: string; user: User }> {
    const email = profile.email.toLowerCase();
    const existing = await this.prisma.client.user.findUnique({ where: { email } });
    if (existing?.status === 'DISABLED') {
      await this.auditLoginFailure(email, 'ACCOUNT_DISABLED', ctx, existing.id);
      throw new LoginError('ACCOUNT_DISABLED', 'Account is disabled');
    }

    const now = new Date();
    const user = await this.prisma.client.user.upsert({
      where: { email },
      create: {
        email,
        name: profile.name ?? email.split('@')[0]!,
        avatarUrl: profile.picture,
        lastLoginAt: now,
      },
      update: {
        name: profile.name ?? existing?.name,
        avatarUrl: profile.picture ?? existing?.avatarUrl,
        lastLoginAt: now,
      },
    });

    if (!existing) await this.joinDefaultWorkspace(user.id, ctx);

    const refresh = this.tokens.newRefreshToken();
    const session = await this.prisma.client.session.create({
      data: {
        userId: user.id,
        absoluteExpiresAt: new Date(
          now.getTime() + this.config.SESSION_ABSOLUTE_TIMEOUT_HOURS * 3600_000,
        ),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        refreshTokens: { create: { tokenHash: refresh.hash } },
      },
    });

    await this.audit.log({
      actorId: user.id,
      action: 'auth.login',
      targetType: 'session',
      targetId: session.id,
      metadata: { method: profile.method },
      ctx,
    });
    return { refreshToken: refresh.token, user };
  }

  async joinDefaultWorkspace(userId: string, ctx?: RequestContext) {
    const slug = this.config.DEFAULT_WORKSPACE_SLUG;
    if (!slug) return;
    const ws = await this.prisma.client.workspace.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true },
    });
    if (!ws) return;
    const role = 'MEMBER' as const;
    const { count } = await this.prisma.client.workspaceMember.createMany({
      data: [{ workspaceId: ws.id, userId, role }],
      skipDuplicates: true,
    });
    if (!count) return;
    await this.audit.log({
      actorId: null,
      action: 'workspace.member_add',
      targetType: 'user',
      targetId: userId,
      workspaceId: ws.id,
      metadata: { auto: true },
      ctx,
    });
  }

  isAllowedGoogleAccount(email: string, hostedDomain: string | undefined): boolean {
    const domain = email.split('@')[1];
    const allowed = this.config.ALLOWED_GOOGLE_DOMAINS;
    return !!domain && !!hostedDomain && allowed.includes(domain) && allowed.includes(hostedDomain);
  }

  isAllowedEmail(email: string): boolean {
    const domain = email.toLowerCase().split('@')[1];
    return !!domain && this.config.ALLOWED_GOOGLE_DOMAINS.includes(domain);
  }

  async refresh(
    refreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<TokenResponse & { refreshToken: string | null }> {
    if (!refreshToken) throw AppError.unauthenticated('Missing refresh token');

    const record = await this.prisma.client.refreshToken.findUnique({
      where: { tokenHash: TokenService.hash(refreshToken) },
      include: { session: { include: { user: true } } },
    });
    if (!record) throw AppError.unauthenticated('Invalid refresh token');

    const { session } = record;
    await this.assertSessionActive(session);

    if (record.rotatedAt) {
      if (Date.now() - record.rotatedAt.getTime() <= REFRESH_GRACE_MS) {
        return { ...(await this.issueAccess(session)), refreshToken: null };
      }
      await this.revokeSession(session.id, 'refresh_token_reuse', ctx, session.userId);
      throw AppError.sessionExpired('refresh_token_reuse');
    }

    const next = this.tokens.newRefreshToken();
    const rotated = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: record.id, rotatedAt: null },
        data: { rotatedAt: new Date() },
      });
      if (count === 0) return false;
      await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: next.hash } });
      return true;
    });

    return { ...(await this.issueAccess(session)), refreshToken: rotated ? next.token : null };
  }

  async logout(params: {
    refreshToken?: string;
    sessionId?: string;
    ctx: RequestContext;
  }): Promise<void> {
    let sessionId = params.sessionId;
    if (!sessionId && params.refreshToken) {
      const record = await this.prisma.client.refreshToken.findUnique({
        where: { tokenHash: TokenService.hash(params.refreshToken) },
        select: { sessionId: true },
      });
      sessionId = record?.sessionId;
    }
    if (sessionId) await this.revokeSession(sessionId, 'logout', params.ctx);
  }

  async revokeSession(
    sessionId: string,
    reason: string,
    ctx?: RequestContext,
    actorId?: string,
  ): Promise<void> {
    const { count } = await this.prisma.client.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (count > 0) {
      const session = await this.prisma.client.session.findUnique({
        where: { id: sessionId },
        select: { userId: true },
      });
      await this.audit.log({
        actorId: actorId ?? session?.userId ?? null,
        action: reason === 'logout' ? 'auth.logout' : 'auth.session_revoked',
        targetType: 'session',
        targetId: sessionId,
        metadata: { reason },
        ctx,
      });
    }
  }

  async revokeAllSessions(userId: string, reason: string): Promise<number> {
    const { count } = await this.prisma.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  async authenticate(accessToken: string): Promise<AuthContext> {
    const payload = await this.tokens.verifyAccess(accessToken);
    if (!payload) throw AppError.unauthenticated('Invalid or expired access token');

    const session = await this.prisma.client.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });
    if (!session || session.userId !== payload.userId) {
      throw AppError.unauthenticated('Invalid session');
    }
    await this.assertSessionActive(session);

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return { user: toAuthenticatedUser(session.user), sessionId: session.id };
  }

  private async assertSessionActive(session: SessionWithUser): Promise<void> {
    if (session.revokedAt) throw AppError.sessionExpired(session.revokedReason ?? 'revoked');

    const now = Date.now();
    let reason: string | null = null;
    if (session.user.status !== 'ACTIVE') reason = 'account_disabled';
    else if (now > session.absoluteExpiresAt.getTime()) reason = 'absolute_timeout';
    else if (now - session.lastSeenAt.getTime() > this.config.SESSION_IDLE_TIMEOUT_MIN * 60_000) {
      reason = 'idle_timeout';
    }
    if (reason) {
      await this.revokeSession(session.id, reason, undefined, session.userId);
      throw AppError.sessionExpired(reason);
    }
  }

  private async issueAccess(session: SessionWithUser): Promise<TokenResponse> {
    return {
      accessToken: await this.tokens.signAccess({
        userId: session.userId,
        sessionId: session.id,
      }),
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSec,
      user: toAuthenticatedUser(session.user),
    };
  }

  private async auditLoginFailure(
    email: string,
    reason: LoginErrorCode,
    ctx: RequestContext,
    userId?: string,
  ) {
    await this.audit.log({
      actorId: userId ?? null,
      action: 'auth.login_failed',
      metadata: { email, reason },
      ctx,
    });
  }

  private oauthKey(state: string): string {
    return `oauth:state:${state}`;
  }
}
