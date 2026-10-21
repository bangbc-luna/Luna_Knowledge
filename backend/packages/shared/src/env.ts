import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url(),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.url(),
});

export const s3EnvSchema = z.object({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(true),
  S3_BUCKET_TMP: z.string().min(3),
  S3_BUCKET_HLS: z.string().min(3),
  S3_BUCKET_PREVIEWS: z.string().min(3),
  S3_BUCKET_THUMBNAILS: z.string().min(3),
  S3_BUCKET_ASSETS: z.string().min(3),
  S3_BUCKET_ORIGINALS: z.string().min(3),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
});

export const searchEnvSchema = z.object({
  MEILI_URL: z.url(),
  MEILI_MASTER_KEY: z.string().min(16),
});

export const processingEnvSchema = z.object({
  TIKA_URL: z.url(),
  GOTENBERG_URL: z.url(),
});

export const uploadEnvSchema = z.object({
  UPLOAD_MAX_FILE_MB: z.coerce.number().int().positive().default(500),
  UPLOAD_MAX_VIDEO_MB: z.coerce.number().int().positive().default(10_240),
});

export const videoEnvSchema = z.object({
  VIDEO_MASTER_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'VIDEO_MASTER_KEY must be 32 bytes, base64',
    ),
  VIDEO_ENCODER: z.enum(['libx264', 'h264_nvenc']).default('libx264'),
  VIDEO_TRANSCODE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
});

function findDotenv(start = process.cwd()): string | undefined {
  let dir = start;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function loadEnv<T extends z.ZodType>(schema: T, source?: NodeJS.ProcessEnv): z.output<T> {
  if (!source) {
    const path = findDotenv();
    if (path) loadDotenv({ path, quiet: true });
  }
  const result = schema.safeParse(source ?? process.env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
