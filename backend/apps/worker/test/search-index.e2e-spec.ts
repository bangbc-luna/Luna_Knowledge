import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@luna/db';
import { createSearchClient, QUEUES, SEARCH_INDEX, SEARCH_JOBS } from '@luna/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { redisConnection } from '../src/config/worker-config.js';
import type { SearchIndexProcessor } from '../src/processors/search-index.processor.js';

const KEY = 'worker_meili_master_key_0123456789';

describe('Search index worker (e2e)', () => {
  const containers: StartedTestContainer[] = [];
  let app: INestApplicationContext;
  let prisma: PrismaClient;
  let processor: SearchIndexProcessor;
  let meili: ReturnType<typeof createSearchClient>;
  let queue: Queue;
  let userId: string;
  let guestId: string;
  let workspaceId: string;

  const run = (name: string, data: object) => processor.process({ name, data } as never);
  const find = async (q: string, filter?: string) =>
    (
      await meili.index(SEARCH_INDEX).search(q, { filter, attributesToRetrieve: ['id', 'name'] })
    ).hits.map((h) => (h as { name: string }).name);
  const doc = (id: string) =>
    meili.index(SEARCH_INDEX).getDocument(id, { fields: ['acl', 'tagIds', 'contentAscii'] });

  beforeAll(async () => {
    const [pg, redis, ms] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('getmeili/meilisearch:v1.16')
        .withEnvironment({
          MEILI_MASTER_KEY: KEY,
          MEILI_NO_ANALYTICS: 'true',
          MEILI_ENV: 'development',
        })
        .withExposedPorts(7700)
        .withWaitStrategy(Wait.forHttp('/health', 7700))
        .start(),
    ]);
    containers.push(pg, redis, ms);
    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL: pg.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
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
      GOTENBERG_URL: 'http://localhost:1',
      VIDEO_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
      MEILI_URL: `http://${ms.getHost()}:${ms.getMappedPort(7700)}`,
      MEILI_MASTER_KEY: KEY,
    });
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: fileURLToPath(new URL('../../../packages/db', import.meta.url)),
      env: process.env,
      stdio: 'pipe',
    });
    meili = createSearchClient(process.env.MEILI_URL!, KEY);
    const { WorkerModule } = await import('../src/worker.module.js');
    const { SearchIndexProcessor } = await import('../src/processors/search-index.processor.js');
    const { PrismaService } = await import('../src/infra/prisma.provider.js');
    app = await (await Test.createTestingModule({ imports: [WorkerModule] }).compile()).init();
    processor = app.get(SearchIndexProcessor);
    prisma = app.get(PrismaService).client;
    queue = new Queue(QUEUES.SEARCH_INDEX, {
      connection: redisConnection(process.env.REDIS_URL!),
      prefix: 'luna',
    });
    for (let i = 0; i < 100; i++) {
      const c = await queue.getJobCounts('waiting', 'active');
      if (!c.waiting && !c.active) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    userId = (await prisma.user.create({ data: { email: 's@lunatech.vn', name: 'S' } })).id;
    guestId = (await prisma.user.create({ data: { email: 'g@lunatech.vn', name: 'G' } })).id;
    workspaceId = (
      await prisma.workspace.create({ data: { name: 'S', slug: 's', createdById: userId } })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await queue?.close();
    await app?.close();
    await Promise.all(containers.map((c) => c.stop()));
  });

  const node = (name: string, parentId: string | null = null, extra: object = {}) =>
    prisma.node.create({
      data: {
        workspaceId,
        parentId,
        type: 'FOLDER',
        name,
        nameNormalized: name.toLowerCase(),
        createdById: userId,
        ...extra,
      },
    });

  it('index một mục: tên và nội dung bỏ dấu, có acl workspace; mục đang tải lên không được index', async () => {
    const d = await node('Đề xuất ngân sách', null, {
      type: 'DOCUMENT',
      document: { create: { contentText: 'Kế hoạch tuyển dụng quý 4' } },
    });
    const up = await node('dang-tai.pdf', null, { type: 'FILE', status: 'UPLOADING' });
    expect(await run(SEARCH_JOBS.INDEX_NODE, { nodeId: d.id })).toEqual({ indexed: 1, removed: 0 });
    expect(await run(SEARCH_JOBS.INDEX_NODE, { nodeId: up.id })).toEqual({
      indexed: 0,
      removed: 1,
    });
    expect(await find('de xuat')).toEqual(['Đề xuất ngân sách']);
    expect(await find('tuyen dung')).toEqual(['Đề xuất ngân sách']);
    expect(await doc(d.id)).toMatchObject({ acl: [`ws:${workspaceId}`] });
  });

  it('share trên thư mục cha: index cả nhánh thêm acl user; xoá mềm thì gỡ khỏi chỉ mục', async () => {
    const parent = await node('Hợp đồng');
    const child = await node('Hợp đồng 2026', parent.id);
    await prisma.nodeShare.create({ data: { nodeId: parent.id, userId: guestId, role: 'VIEWER' } });
    expect(await run(SEARCH_JOBS.INDEX_TREE, { nodeId: parent.id })).toEqual({
      indexed: 2,
      removed: 0,
    });
    expect((await doc(child.id)).acl).toEqual([`ws:${workspaceId}`, `user:${guestId}`]);
    expect(await find('hop dong', `acl IN ["user:${guestId}"]`)).toHaveLength(2);

    await prisma.node.updateMany({
      where: { id: { in: [parent.id, child.id] } },
      data: { deletedAt: new Date() },
    });
    expect(await run(SEARCH_JOBS.INDEX_TREE, { nodeId: parent.id })).toEqual({
      indexed: 0,
      removed: 2,
    });
    expect(await find('hop dong')).toEqual([]);
  });

  it('dựng lại toàn bộ chỉ mục bằng index tạm rồi hoán đổi; dọn mục mồ côi', async () => {
    await meili
      .index(SEARCH_INDEX)
      .addDocuments([
        {
          id: '00000000-0000-0000-0000-00000000dead',
          name: 'Mồ côi',
          nameAscii: 'Mo coi',
          acl: [],
        },
      ])
      .waitTask();
    const tag = await prisma.tag.create({
      data: { workspaceId, name: 'Pháp lý', color: '#000000' },
    });
    const f = await node('Chính sách bảo mật', null, {
      type: 'FILE',
      file: { create: { extractedText: 'Dữ liệu cá nhân được mã hoá' } },
    });
    await prisma.nodeTag.create({ data: { nodeId: f.id, tagId: tag.id } });
    const res = (await run(SEARCH_JOBS.REINDEX_ALL, {})) as { total: number };
    expect(res.total).toBe(2);
    expect(await find('mo coi')).toEqual([]);
    expect(await find('phap ly')).toEqual(['Chính sách bảo mật']);
    expect(await find('ma hoa')).toEqual(['Chính sách bảo mật']);
    expect((await doc(f.id)).tagIds).toEqual([tag.id]);
    expect((await meili.getIndexes()).results.map((i) => i.uid)).toEqual([SEARCH_INDEX]);
  });

  it('xoá workspace: gỡ mọi tài liệu của workspace đó', async () => {
    await run(SEARCH_JOBS.DROP_WORKSPACE, { workspaceId });
    expect(await find('chinh sach')).toEqual([]);
    expect(await find('de xuat')).toEqual([]);
  });
});
