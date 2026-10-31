import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureAppLogin } from '@luna/db';
import { createS3Client, ensureBuckets, loadEnv, s3EnvSchema } from '@luna/shared';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

const MINIO_IMAGE = 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z';
const MINIO_USER = 'e2e_minio';
const MINIO_PASSWORD = 'e2e_minio_password';
const MEILI_KEY = 'e2e_meili_master_key_0123456789';

let containers: Array<StartedPostgreSqlContainer | StartedRedisContainer | StartedTestContainer> =
  [];

export async function setup() {
  const [postgres, redis, minio, meili] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
    new GenericContainer(MINIO_IMAGE)
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: MINIO_USER, MINIO_ROOT_PASSWORD: MINIO_PASSWORD })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start(),
    new GenericContainer('getmeili/meilisearch:v1.16')
      .withEnvironment({
        MEILI_MASTER_KEY: MEILI_KEY,
        MEILI_NO_ANALYTICS: 'true',
        MEILI_ENV: 'development',
      })
      .withExposedPorts(7700)
      .withWaitStrategy(Wait.forHttp('/health', 7700))
      .start(),
  ]);
  containers = [postgres, redis, minio, meili];

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    S3_ENDPOINT: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    S3_ACCESS_KEY: MINIO_USER,
    S3_SECRET_KEY: MINIO_PASSWORD,
    S3_FORCE_PATH_STYLE: 'true',
    MEILI_URL: `http://${meili.getHost()}:${meili.getMappedPort(7700)}`,
    MEILI_MASTER_KEY: MEILI_KEY,
    S3_BUCKET_TMP: 'e2e-tmp',
    S3_BUCKET_HLS: 'e2e-hls',
    S3_BUCKET_PREVIEWS: 'e2e-previews',
    S3_BUCKET_THUMBNAILS: 'e2e-thumbnails',
    S3_BUCKET_ASSETS: 'e2e-assets',
    S3_BUCKET_ORIGINALS: 'e2e-originals',
    CORS_ORIGINS: 'http://localhost:5173',
    API_PUBLIC_URL: 'http://localhost:4000',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    ALLOWED_GOOGLE_DOMAINS: 'lunatech.vn',
    JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789-abcdefghij',
    VIDEO_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    COLLAB_TOKEN_SECRET: 'e2e-collab-token-secret-0123456789abcdef',
    COLLAB_INTERNAL_SECRET: 'e2e-collab-internal-secret-0123456789ab',
    AUTH_REDIRECT_URL: 'http://localhost:5173/auth/done',
    SESSION_IDLE_TIMEOUT_MIN: '60',
    SESSION_ABSOLUTE_TIMEOUT_HOURS: '12',
    RATE_LIMIT_USER_PER_MIN: '100000',
    RATE_LIMIT_ANON_PER_MIN: '100000',
  });

  const dbPackage = fileURLToPath(new URL('../../../packages/db', import.meta.url));
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: process.env,
    stdio: 'pipe',
  });

  const appUrl = new URL(postgres.getConnectionUri());
  appUrl.username = 'luna_app_e2e';
  appUrl.password = 'e2e_app_password';
  await ensureAppLogin(postgres.getConnectionUri(), appUrl.toString());
  process.env.DATABASE_APP_URL = appUrl.toString();

  const s3Env = loadEnv(s3EnvSchema, process.env);
  const s3 = createS3Client(s3Env);
  await ensureBuckets(s3, s3Env);
  s3.destroy();
}

export async function teardown() {
  await Promise.all(containers.map((c) => c.stop()));
}
