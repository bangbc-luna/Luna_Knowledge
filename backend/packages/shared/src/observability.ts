import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { z } from 'zod';
import { optionalEnv } from './env.js';

export const observabilityEnvSchema = z.object({
  METRICS_TOKEN: z.string().min(16).optional(),
  SENTRY_DSN: optionalEnv(z.url()),
  SENTRY_ENVIRONMENT: optionalEnv(z.string()),
});

export function requireMetricsTokenInProduction(env: { NODE_ENV?: string; METRICS_TOKEN?: string }, ctx: z.RefinementCtx) {
  if (env.NODE_ENV === 'production' && !env.METRICS_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['METRICS_TOKEN'], message: 'METRICS_TOKEN is required in production' });
  }
}

export function createMetricsRegistry(service: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  return registry;
}

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/, /^fc/i, /^fd/i, /^::ffff:(127|10|192\.168)\./];

export function metricsAllowed(remoteAddress: string | undefined, authorization: string | undefined, token?: string) {
  if (token) {
    const given = Buffer.from((authorization ?? '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(token);
    return given.length === want.length && timingSafeEqual(given, want);
  }
  return !!remoteAddress && PRIVATE.some((re) => re.test(remoteAddress));
}

let sentryOn = false;

export function initSentry(service: string, env: { SENTRY_DSN?: string; SENTRY_ENVIRONMENT?: string; NODE_ENV?: string }) {
  if (!env.SENTRY_DSN || sentryOn) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    serverName: service,
    tracesSampleRate: 0,
  });
  sentryOn = true;
}

export function reportError(err: unknown, context?: Record<string, unknown>) {
  if (!sentryOn) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
