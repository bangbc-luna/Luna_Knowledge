import {
  baseEnvSchema,
  databaseEnvSchema,
  httpServerEnvSchema,
  loadEnv,
  redisEnvSchema,
  s3EnvSchema,
  observabilityEnvSchema,
  optionalEnv,
  searchEnvSchema,
  uploadEnvSchema,
  videoEnvSchema,
  collabSecretsSchema,
} from '@luna/shared';
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const apiEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend(s3EnvSchema.shape)
  .extend(uploadEnvSchema.shape)
  .extend(videoEnvSchema.pick({ VIDEO_MASTER_KEY: true }).shape)
  .extend(collabSecretsSchema.shape)
  .extend(searchEnvSchema.shape)
  .extend(observabilityEnvSchema.shape)
  .extend(httpServerEnvSchema.shape)
  .extend({
    API_PORT: z.coerce.number().int().positive().default(4000),
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
    COLLAB_INTERNAL_URL: z.url().default('http://localhost:4001'),
    COLLAB_PUBLIC_URL: z.string().default('ws://localhost:4001'),
    WEB_PUBLIC_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: csv,
    TRUST_PROXY: z.string().default('loopback, uniquelocal'),
    REMOTE_VIDEO_MAX_HEIGHT: z.coerce.number().int().positive().default(720),

    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    ALLOWED_GOOGLE_DOMAINS: csv.pipe(z.array(z.string()).min(1)),
    JWT_ACCESS_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
    SESSION_IDLE_TIMEOUT_MIN: z.coerce.number().int().positive().default(60),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(12),
    AUTH_REDIRECT_URL: optionalEnv(z.url()),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_ANON_PER_MIN: z.coerce.number().int().positive().default(120),
    BODY_LIMIT: z.string().default('512kb'),
    SWAGGER_ENABLED: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .refine((env) => !env.CORS_ORIGINS.includes('*'), {
    message: 'CORS_ORIGINS must list explicit origins (cookies are sent cross-origin)',
    path: ['CORS_ORIGINS'],
  })
  .transform((env) => ({
    ...env,
    AUTH_REDIRECT_URL: env.AUTH_REDIRECT_URL ?? env.WEB_PUBLIC_URL,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
  }));

export type AppConfig = z.output<typeof apiEnvSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadAppConfig(source?: NodeJS.ProcessEnv): AppConfig {
  return loadEnv(apiEnvSchema, source);
}
