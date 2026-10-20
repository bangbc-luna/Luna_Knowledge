import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { describeError } from '../common/errors/infra-errors.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import { BUCKETS, type Buckets, S3 } from '../infra/s3/s3.module.js';

const TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS).unref(),
    ),
  ]);
}

@Injectable()
export class InfraHealthIndicators {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(BUCKETS) private readonly buckets: Buckets,
  ) {}

  async database() {
    const check = this.health.check('database');
    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`);
      return check.up();
    } catch (err) {
      return check.down(describeError(err));
    }
  }

  async redisPing() {
    const check = this.health.check('redis');
    try {
      await withTimeout(this.redis.ping());
      return check.up();
    } catch (err) {
      return check.down(describeError(err));
    }
  }

  /** Kiểm tra mọi bucket tồn tại: thiếu bucket nghĩa là chưa chạy `pnpm infra:init`. */
  async storage() {
    const check = this.health.check('storage');
    try {
      await withTimeout(
        Promise.all(
          Object.values(this.buckets).map((Bucket) =>
            this.s3.send(new HeadBucketCommand({ Bucket })),
          ),
        ),
      );
      return check.up();
    } catch (err) {
      return check.down(describeError(err));
    }
  }
}
