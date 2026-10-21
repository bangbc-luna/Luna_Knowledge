import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger } from 'nestjs-pino';
import { describeError } from './common/errors/infra-errors.js';
import { PrismaService } from './infra/prisma/prisma.service.js';
import { REDIS } from './infra/redis/redis.module.js';

const TIMEOUT_MS = 3000;

async function probe(check: () => Promise<unknown>): Promise<string | null> {
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS).unref(),
      ),
    ]);
    return null;
  } catch (err) {
    return describeError(err);
  }
}

export async function warnIfDependenciesDown(app: INestApplication, logger: Logger) {
  const prisma = app.get(PrismaService).client;
  const redis = app.get<Redis>(REDIS);
  const [db, cache] = await Promise.all([
    probe(() => prisma.$queryRaw`SELECT 1`),
    probe(() => redis.ping()),
  ]);
  const down = [db && `PostgreSQL (${db})`, cache && `Redis (${cache})`].filter(Boolean);
  if (down.length) {
    logger.warn(
      `Dependencies unreachable: ${down.join(', ')}. ` +
        'Start the dev infrastructure with `pnpm infra:up`, then check `curl localhost:4000/health`.',
    );
  }
}
