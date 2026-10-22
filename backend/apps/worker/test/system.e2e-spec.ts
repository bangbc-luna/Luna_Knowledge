import { QUEUES } from '@luna/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from '../src/config/worker-config.js';
import type { PingResult } from '../src/processors/system.processor.js';

describe('Worker system queue (e2e)', () => {
  let redis: StartedRedisContainer;
  let app: INestApplicationContext;
  let queue: Queue;
  let events: QueueEvents;

  beforeAll(async () => {
    redis = await new RedisContainer('redis:7-alpine').start();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      REDIS_URL: redis.getConnectionUrl(),
      DATABASE_URL: 'postgresql://unused:unused@localhost:1/unused',
      S3_ENDPOINT: 'http://localhost:1',
      S3_ACCESS_KEY: 'unused',
      S3_SECRET_KEY: 'unused',
      S3_BUCKET_TMP: 'unused',
      S3_BUCKET_HLS: 'unused',
      S3_BUCKET_PREVIEWS: 'unused',
      S3_BUCKET_THUMBNAILS: 'unused',
      S3_BUCKET_ASSETS: 'unused',
      S3_BUCKET_ORIGINALS: 'unused',
      TIKA_URL: 'http://localhost:1',
      VIDEO_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
      GOTENBERG_URL: 'http://localhost:1',
      MEILI_URL: 'http://localhost:1',
      MEILI_MASTER_KEY: 'unused-meili-master-key',
    });
    const { WorkerModule } = await import('../src/worker.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    app = await moduleRef.init();

    const connection = redisConnection(redis.getConnectionUrl());
    queue = new Queue(QUEUES.SYSTEM, { connection, prefix: 'luna' });
    events = new QueueEvents(QUEUES.SYSTEM, { connection, prefix: 'luna' });
    await events.waitUntilReady();
  });

  afterAll(async () => {
    await events?.close();
    await queue?.close();
    await app?.close();
    await redis?.stop();
  });

  it('xử lý job ping và trả kết quả', async () => {
    const job = await queue.add('ping', {});
    const result = (await job.waitUntilFinished(events, 10_000)) as PingResult;
    expect(result.pong).toBe(true);
    expect(result.workerPid).toBe(process.pid);
  });

  it('job không xác định bị đánh dấu failed', async () => {
    const job = await queue.add('unknown-job', {}, { attempts: 1 });
    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow(/Unknown job/);
  });
});
