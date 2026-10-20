import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@luna/db';
import { createS3Client, ensureBuckets, loadEnv, s3EnvSchema } from '@luna/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { UnrecoverableError } from 'bullmq';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { FileProcessProcessor } from '../src/processors/file-process.processor.js';
import type { MaintenanceProcessor } from '../src/processors/maintenance.processor.js';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const BUCKETS = {
  S3_BUCKET_TMP: 'w-tmp',
  S3_BUCKET_HLS: 'w-hls',
  S3_BUCKET_PREVIEWS: 'w-previews',
  S3_BUCKET_THUMBNAILS: 'w-thumbnails',
  S3_BUCKET_ASSETS: 'w-assets',
  S3_BUCKET_ORIGINALS: 'w-originals',
};

describe('Worker file-process (e2e)', () => {
  const containers: StartedTestContainer[] = [];
  let app: INestApplicationContext;
  let prisma: PrismaClient;
  let processor: FileProcessProcessor;
  let maintenance: MaintenanceProcessor;
  let s3: ReturnType<typeof createS3Client>;
  let userId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const [pg, redis, minio, gotenberg, tika] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('pgsty/minio:RELEASE.2026-08-04T00-00-00Z')
        .withCommand(['server', '/data'])
        .withEnvironment({ MINIO_ROOT_USER: 'w_minio', MINIO_ROOT_PASSWORD: 'w_minio_password' })
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
        .start(),
      new GenericContainer('gotenberg/gotenberg:8')
        .withExposedPorts(3000)
        .withWaitStrategy(Wait.forHttp('/health', 3000))
        .start(),
      new GenericContainer('apache/tika:latest-full')
        .withExposedPorts(9998)
        .withWaitStrategy(Wait.forHttp('/version', 9998))
        .start(),
    ]);
    containers.push(pg, redis, minio, gotenberg, tika);
    const url = (c: StartedTestContainer, port: number) =>
      `http://${c.getHost()}:${c.getMappedPort(port)}`;

    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL: pg.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
      S3_ENDPOINT: url(minio, 9000),
      S3_ACCESS_KEY: 'w_minio',
      S3_SECRET_KEY: 'w_minio_password',
      S3_FORCE_PATH_STYLE: 'true',
      ...BUCKETS,
      GOTENBERG_URL: url(gotenberg, 3000),
      TIKA_URL: url(tika, 9998),
    });
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: fileURLToPath(new URL('../../../packages/db', import.meta.url)),
      env: process.env,
      stdio: 'pipe',
    });
    const s3Env = loadEnv(s3EnvSchema, process.env);
    s3 = createS3Client(s3Env);
    await ensureBuckets(s3, s3Env);

    const { WorkerModule } = await import('../src/worker.module.js');
    const { FileProcessProcessor } = await import('../src/processors/file-process.processor.js');
    const { MaintenanceProcessor } = await import('../src/processors/maintenance.processor.js');
    const { PrismaService } = await import('../src/infra/prisma.provider.js');
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    app = await moduleRef.init();
    processor = app.get(FileProcessProcessor);
    maintenance = app.get(MaintenanceProcessor);
    prisma = app.get(PrismaService).client;

    const user = await prisma.user.create({
      data: { email: 'w@lunatech.vn', name: 'Worker test' },
    });
    const ws = await prisma.workspace.create({
      data: { name: 'W', slug: 'w', createdById: user.id },
    });
    userId = user.id;
    workspaceId = ws.id;
  });

  afterAll(async () => {
    await app?.close();
    s3?.destroy();
    await Promise.all(containers.map((c) => c.stop()));
  });

  /** Dựng trạng thái như ngay sau khi API hoàn tất upload: node PROCESSING + object trong tmp. */
  async function completedUpload(
    fixture: string,
    opts: { as?: string; nodeId?: string; type?: 'FILE' | 'VIDEO' } = {},
  ) {
    const body = await readFile(FIXTURES + fixture);
    const fileName = opts.as ?? fixture;
    const node =
      opts.nodeId ??
      (
        await prisma.node.create({
          data: {
            workspaceId,
            type: opts.type ?? 'FILE',
            name: `${fileName}-${Math.random()}`,
            nameNormalized: `${fileName}-${Math.random()}`,
            status: 'PROCESSING',
            createdById: userId,
          },
        })
      ).id;
    const id = crypto.randomUUID();
    const tmpKey = `uploads/${id}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKETS.S3_BUCKET_TMP, Key: tmpKey, Body: body }));
    await prisma.uploadSession.create({
      data: {
        id,
        nodeId: node,
        workspaceId,
        s3UploadId: 'done',
        tmpKey,
        fileName,
        sizeBytes: BigInt(body.length),
        partSize: 16 * 1024 * 1024,
        partCount: 1,
        mimeDeclared: 'application/octet-stream',
        isNewVersion: Boolean(opts.nodeId),
        status: 'COMPLETED',
        createdById: userId,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return { uploadId: id, nodeId: node, tmpKey, size: body.length };
  }

  const exists = (bucket: string, key: string) =>
    s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(
      () => true,
      () => false,
    );

  const versionOf = (id: string) =>
    prisma.fileVersion.findUniqueOrThrow({
      where: { id },
      include: { original: true, preview: true, thumbnail: true },
    });

  it('DOCX: lưu bản gốc + SHA-256, preview PDF (Gotenberg), trích chữ (Tika), dọn tmp', async () => {
    const { uploadId, nodeId, tmpKey, size } = await completedUpload('sample.docx');
    await processor.processUpload(uploadId);

    const node = await prisma.node.findUniqueOrThrow({
      where: { id: nodeId },
      include: { file: true },
    });
    expect(node.status).toBe('READY');
    expect(node.file?.currentVersionId).toBe(uploadId);
    expect(node.file?.extractedText).toContain('Quy trình onboarding Lunatech');

    const v = await versionOf(uploadId);
    expect(v.versionNo).toBe(1);
    expect(v.original.mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(Number(v.original.sizeBytes)).toBe(size);
    expect(v.original.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.previewKind).toBe('pdf');
    const pdf = await s3.send(
      new GetObjectCommand({ Bucket: v.preview!.container, Key: v.preview!.key }),
    );
    expect((await pdf.Body!.transformToString()).startsWith('%PDF')).toBe(true);
    expect(await exists(BUCKETS.S3_BUCKET_TMP, tmpKey)).toBe(false);

    // Chạy lại job (BullMQ retry): không tạo phiên bản thứ hai.
    expect(await processor.processUpload(uploadId)).toEqual({ skipped: 'already processed' });
    expect(await prisma.fileVersion.count({ where: { nodeId } })).toBe(1);
  }, 120_000);

  it('XLSX: preview PDF', async () => {
    const { uploadId } = await completedUpload('sample.xlsx');
    await processor.processUpload(uploadId);
    expect((await versionOf(uploadId)).previewKind).toBe('pdf');
  }, 120_000);

  it('PNG: preview webp + thumbnail; TXT: preview chữ', async () => {
    const png = await completedUpload('sample.png');
    await processor.processUpload(png.uploadId);
    const v = await versionOf(png.uploadId);
    expect(v.previewKind).toBe('image');
    expect(v.preview?.mime).toBe('image/webp');
    expect(v.thumbnail?.mime).toBe('image/webp');

    const txt = await completedUpload('sample.txt');
    await processor.processUpload(txt.uploadId);
    const t = await prisma.node.findUniqueOrThrow({
      where: { id: txt.nodeId },
      include: { file: true },
    });
    expect((await versionOf(txt.uploadId)).previewKind).toBe('text');
    expect(t.file?.extractedText).toContain('Ghi chú họp tuần');
  }, 60_000);

  it('.exe đổi đuôi thành .pdf bị từ chối vĩnh viễn, mục báo FAILED', async () => {
    const { uploadId, nodeId, tmpKey } = await completedUpload('fake-exe.pdf', {
      as: 'invoice.pdf',
    });
    const err = await processor.processUpload(uploadId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as Error).message).toMatch(/not an allowed type/);
    expect(await exists(BUCKETS.S3_BUCKET_TMP, tmpKey)).toBe(false);
    expect(await prisma.blob.count({ where: { nodeId } })).toBe(0);

    // Worker gọi onFailed khi job thất bại lần cuối.
    await processor.onFailed(
      {
        name: 'process-upload',
        data: { uploadId },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as never,
      err as Error,
    );
    const node = await prisma.node.findUniqueOrThrow({
      where: { id: nodeId },
      include: { file: true },
    });
    expect(node.status).toBe('FAILED');
    expect(node.file?.processingError).toMatch(/not an allowed type/);
  });

  it('chữ giả dạng (byte nhị phân trong .txt) bị từ chối; video trong upload FILE bị từ chối', async () => {
    const bin = await completedUpload('sample.png', { as: 'notes.txt' });
    // PNG có magic bytes → nhận ra là ảnh hợp lệ dù đuôi .txt (dùng loại thật).
    await processor.processUpload(bin.uploadId);
    expect((await versionOf(bin.uploadId)).original.mime).toBe('image/png');

    const exe = await completedUpload('fake-exe.pdf', { as: 'readme.txt' });
    await expect(processor.processUpload(exe.uploadId)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('phiên bản lỗi không làm mất phiên bản đang dùng', async () => {
    const first = await completedUpload('sample.pdf');
    await processor.processUpload(first.uploadId);
    const bad = await completedUpload('fake-exe.pdf', { as: 'v2.pdf', nodeId: first.nodeId });
    const err = await processor.processUpload(bad.uploadId).catch((e: Error) => e);
    await processor.onFailed(
      {
        name: 'process-upload',
        data: { uploadId: bad.uploadId },
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as never,
      err as Error,
    );
    const node = await prisma.node.findUniqueOrThrow({
      where: { id: first.nodeId },
      include: { file: true },
    });
    expect(node.status).toBe('READY');
    expect(node.file?.currentVersionId).toBe(first.uploadId);
    expect(node.file?.processingError).toBeTruthy();
  });

  it('regenerate thay preview mới; preview cũ được dọn bởi GC; xóa node dọn mọi object', async () => {
    const { uploadId, nodeId } = await completedUpload('sample.docx', { as: 'regen.docx' });
    await processor.processUpload(uploadId);
    const before = await versionOf(uploadId);

    await processor.regenerate({ nodeId, versionId: uploadId });
    const after = await versionOf(uploadId);
    expect(after.preview!.key).not.toBe(before.preview!.key);
    expect(await exists(after.preview!.container, after.preview!.key)).toBe(true);

    await maintenance.collectGarbage();
    expect(await exists(before.preview!.container, before.preview!.key)).toBe(false);

    await prisma.node.delete({ where: { id: nodeId } });
    expect(await prisma.blobGc.count()).toBe(2);
    expect(await maintenance.collectGarbage()).toEqual({ deleted: 2, failed: 0 });
    expect(await exists(after.original.container, after.original.key)).toBe(false);
    expect(await exists(after.preview!.container, after.preview!.key)).toBe(false);
  }, 120_000);

  it('video: lưu bản gốc, chờ transcode (Phase 4)', async () => {
    // Video thật không có trong fixtures: dùng header MP4 tối thiểu (ftyp isom).
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from('isomiso2'),
      Buffer.alloc(64),
    ]);
    const node = await prisma.node.create({
      data: {
        workspaceId,
        type: 'VIDEO',
        name: 'clip.mp4',
        nameNormalized: 'clip.mp4',
        status: 'PROCESSING',
        createdById: userId,
      },
    });
    const id = crypto.randomUUID();
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKETS.S3_BUCKET_TMP, Key: `uploads/${id}`, Body: mp4 }),
    );
    await prisma.uploadSession.create({
      data: {
        id,
        nodeId: node.id,
        workspaceId,
        s3UploadId: 'done',
        tmpKey: `uploads/${id}`,
        fileName: 'clip.mp4',
        sizeBytes: BigInt(mp4.length),
        partSize: 1,
        partCount: 1,
        mimeDeclared: 'video/mp4',
        status: 'COMPLETED',
        createdById: userId,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await processor.processUpload(id);
    const v = await versionOf(id);
    expect(v.original.mime).toBe('video/mp4');
    expect(v.previewKind).toBe('none');
    expect((await prisma.node.findUniqueOrThrow({ where: { id: node.id } })).status).toBe(
      'PROCESSING',
    );
  });

  it('dọn upload bỏ dở quá hạn: xóa mục đang chờ, giữ file đã có', async () => {
    const pending = await prisma.node.create({
      data: {
        workspaceId,
        type: 'FILE',
        name: 'abandoned.pdf',
        nameNormalized: 'abandoned.pdf',
        status: 'UPLOADING',
        createdById: userId,
      },
    });
    await prisma.uploadSession.create({
      data: {
        nodeId: pending.id,
        workspaceId,
        s3UploadId: 'missing',
        tmpKey: 'uploads/abandoned',
        fileName: 'abandoned.pdf',
        sizeBytes: 10n,
        partSize: 1,
        partCount: 1,
        mimeDeclared: 'application/pdf',
        createdById: userId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const result = await maintenance.cleanUploads();
    expect(result.aborted).toBe(1);
    expect(await prisma.node.findUnique({ where: { id: pending.id } })).toBeNull();
  });
});
