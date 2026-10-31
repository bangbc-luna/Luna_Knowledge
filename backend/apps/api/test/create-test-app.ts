import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { AppModule } from '../src/app.module.js';
import { GOOGLE_IDENTITY, type GoogleClaims } from '../src/auth/google/google-identity.js';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';
import { companyClaims, FakeGoogleIdentity } from './fake-google-identity.js';

export interface TestContext {
  app: INestApplication;
  google: FakeGoogleIdentity;
  prisma: PrismaService['client'];
  close(): Promise<void>;
}

export async function createTestApp(
  overrides: Array<[unknown, unknown]> = [],
): Promise<TestContext> {
  const google = new FakeGoogleIdentity();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GOOGLE_IDENTITY)
    .useValue(google);
  for (const [token, value] of overrides)
    builder = builder.overrideProvider(token as never).useValue(value);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  setupApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return { app, google, prisma: app.get(PrismaService).client, close: () => app.close() };
}

export async function resetDatabase(prisma: TestContext['prisma']) {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_truncate'),
    prisma.$executeRawUnsafe(
      'TRUNCATE notifications, blob_gc, audit_logs, recent_views, favorites, node_tags, tags, node_shares, nodes, refresh_tokens, sessions, workspace_members, workspaces, users CASCADE',
    ),
    prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_truncate'),
  ]);
}

export interface LoggedIn {
  agent: TestAgent;
  accessToken: string;
  userId: string;
  auth: { Authorization: string };
}

export async function loginAs(
  ctx: TestContext,
  email: string,
  overrides: Partial<GoogleClaims> = {},
): Promise<LoggedIn> {
  const agent = request.agent(ctx.app.getHttpServer());
  const start = await agent.get('/api/v1/auth/google').set('Host', 'localhost:4000').expect(302);
  const state = new URL(start.headers.location!).searchParams.get('state')!;

  ctx.google.nextClaims = companyClaims(email, overrides);
  const callback = await agent
    .get('/api/v1/auth/google/callback')
    .query({ code: 'fake-code', state })
    .expect(302);
  const error = new URL(callback.headers.location!).searchParams.get('error');
  if (error) throw new Error(`login failed: ${error}`);

  const refreshed = await agent.post('/api/v1/auth/refresh').expect(200);
  return {
    agent,
    accessToken: refreshed.body.accessToken,
    userId: refreshed.body.user.id,
    auth: { Authorization: `Bearer ${refreshed.body.accessToken}` },
  };
}

export async function loginAsAdmin(ctx: TestContext, email = 'admin@lunatech.vn') {
  await ctx.prisma.user.upsert({
    where: { email },
    create: { email, name: 'Admin', isSystemAdmin: true },
    update: { isSystemAdmin: true },
  });
  return loginAs(ctx, email);
}

export function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
}

export function cookiePair(res: request.Response, name: string): string | undefined {
  return setCookies(res)
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];
}
