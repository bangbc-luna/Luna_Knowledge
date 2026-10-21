import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@luna/db';
import { createDecipheriv } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createS3Client, ensureBuckets, loadEnv, openVideoKey, s3EnvSchema } from '@luna/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { UnrecoverableError } from 'bullmq';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { FileProcessProcessor } from '../src/processors/file-process.processor.js';
import type { MaintenanceProcessor } from '../src/processors/maintenance.processor.js';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
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
      VIDEO_MASTER_KEY: MASTER_KEY,
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

  async function waitSettled(nodeId: string, timeoutMs = 120_000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const n = await prisma.node.findUniqueOrThrow({
        where: { id: nodeId },
        include: { file: true },
      });
      if (n.status !== 'PROCESSING') return n;
      if (Date.now() > until) throw new Error('timeout waiting for transcode');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function videoUpload(body: Buffer, fileName: string) {
    const node = await prisma.node.create({
      data: {
        workspaceId,
        type: 'VIDEO',
        name: fileName,
        nameNormalized: `${fileName}-${Math.random()}`,
        status: 'PROCESSING',
        createdById: userId,
      },
    });
    const id = crypto.randomUUID();
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKETS.S3_BUCKET_TMP, Key: `uploads/${id}`, Body: body }),
    );
    await prisma.uploadSession.create({
      data: {
        id,
        nodeId: node.id,
        workspaceId,
        s3UploadId: 'done',
        tmpKey: `uploads/${id}`,
        fileName,
        sizeBytes: BigInt(body.length),
        partSize: 16 * 1024 * 1024,
        partCount: 1,
        mimeDeclared: 'video/mp4',
        status: 'COMPLETED',
        createdById: userId,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await processor.processUpload(id);
    return { nodeId: node.id, versionId: id };
  }

  it('video: transcode HLS 360p/720p mã hoá AES-128, poster, thumbnail, sprite', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'luna-vtest-'));
    const src = join(dir, 'clip.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '8',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-shortest',
      src,
    ]);
    const { nodeId, versionId } = await videoUpload(await readFile(src), 'Hướng dẫn.mp4');

    const node = await waitSettled(nodeId);
    expect(node.status).toBe('READY');
    const video = await prisma.video.findUniqueOrThrow({ where: { nodeId } });
    expect(video.versionId).toBe(versionId);
    expect(video.width).toBe(1280);
    expect(video.height).toBe(720);
    expect(Math.round(video.durationSec)).toBe(8);
    expect((video.renditions as Array<{ name: string }>).map((r) => r.name)).toEqual([
      '360p',
      '720p',
    ]);
    expect(video.spriteVtt).toMatch(/^WEBVTT[\s\S]*sprite\.jpg#xywh=0,0,160,90/);

    const hls = await prisma.blob.findUniqueOrThrow({ where: { id: video.hlsBlobId } });
    const get = async (key: string) =>
      Buffer.from(
        await (
          await s3.send(new GetObjectCommand({ Bucket: BUCKETS.S3_BUCKET_HLS, Key: key }))
        ).Body!.transformToByteArray(),
      );
    const master = (await get(`${hls.key}master.m3u8`)).toString();
    expect(master).toContain('360p/index.m3u8');
    expect(master).toContain('RESOLUTION=1280x720');
    const playlist = (await get(`${hls.key}720p/index.m3u8`)).toString();
    const keyLine = /#EXT-X-KEY:METHOD=AES-128,URI="luna-key",IV=0x([0-9a-f]{32})/i.exec(playlist);
    expect(keyLine).not.toBeNull();
    const firstSeg = playlist.split('\n').find((l) => l.endsWith('.ts'))!;

    const enc = await get(`${hls.key}720p/${firstSeg}`);
    expect(enc[0] === 0x47 && enc[188] === 0x47).toBe(false);
    const key = openVideoKey(video.keyEncrypted, MASTER_KEY);
    const d = createDecipheriv('aes-128-cbc', key, Buffer.from(keyLine![1]!, 'hex'));
    const plain = Buffer.concat([d.update(enc), d.final()]);
    expect(plain[0]).toBe(0x47);
    expect(plain[188]).toBe(0x47);

    const version = await prisma.fileVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { thumbnail: true },
    });
    expect(version.thumbnail?.mime).toBe('image/webp');
    expect(
      await prisma.blob.count({ where: { nodeId, kind: { in: ['POSTER', 'SPRITE', 'HLS'] } } }),
    ).toBe(3);

    const vt = app.get(
      (await import('../src/processors/video-transcode.processor.js')).VideoTranscodeProcessor,
    );
    await vt.transcode({ nodeId, versionId });
    const again = await prisma.video.findUniqueOrThrow({ where: { nodeId } });
    expect(again.hlsBlobId).not.toBe(video.hlsBlobId);
    await maintenance.collectGarbage();
    expect(await exists(BUCKETS.S3_BUCKET_HLS, `${hls.key}master.m3u8`)).toBe(false);
    expect(await exists(BUCKETS.S3_BUCKET_HLS, `${hls.key}720p/${firstSeg}`)).toBe(false);
  }, 180_000);

  it('job của phiên bản không còn hiện tại không ghi đè; lỗi của nó không đổi trạng thái', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'luna-vtest-'));
    const src = join(dir, 'small.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=25',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      src,
    ]);
    const { nodeId, versionId } = await videoUpload(await readFile(src), 'Hai phiên bản.mp4');
    await waitSettled(nodeId);
    const before = await prisma.video.findUniqueOrThrow({ where: { nodeId } });

    const original = await prisma.blob.findFirstOrThrow({ where: { nodeId, kind: 'ORIGINAL' } });
    const other = await prisma.fileVersion.create({
      data: {
        nodeId,
        versionNo: 2,
        fileName: 'v2.mp4',
        originalBlobId: original.id,
        uploadedById: userId,
      },
    });
    await prisma.fileInfo.update({ where: { nodeId }, data: { currentVersionId: other.id } });

    const vt = app.get(
      (await import('../src/processors/video-transcode.processor.js')).VideoTranscodeProcessor,
    );
    expect(await vt.transcode({ nodeId, versionId })).toEqual({
      skipped: 'not the current version',
    });
    expect((await prisma.video.findUniqueOrThrow({ where: { nodeId } })).hlsBlobId).toBe(
      before.hlsBlobId,
    );

    await prisma.node.update({ where: { id: nodeId }, data: { status: 'PROCESSING' } });
    await vt.onFailed(
      {
        name: 'transcode',
        data: { nodeId, versionId },
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as never,
      new Error('x'),
    );
    expect((await prisma.node.findUniqueOrThrow({ where: { id: nodeId } })).status).toBe(
      'PROCESSING',
    );

    await vt.onFailed(
      {
        name: 'transcode',
        data: { nodeId, versionId: other.id },
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as never,
      new Error('x'),
    );
    expect((await prisma.node.findUniqueOrThrow({ where: { id: nodeId } })).status).toBe('FAILED');
  }, 120_000);

  it('video hỏng (chỉ có header MP4) → FAILED kèm lý do, không thử lại', async () => {
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from('isomiso2'),
      Buffer.alloc(64),
    ]);
    const { nodeId } = await videoUpload(mp4, 'hong.mp4');
    const node = await waitSettled(nodeId);
    expect(node.status).toBe('FAILED');
    expect(node.file?.processingError).toMatch(/video/i);
    expect(node.file?.processingError).not.toMatch(/ffprobe|\/tmp|moov/);
    expect(await prisma.video.findUnique({ where: { nodeId } })).toBeNull();
  }, 60_000);

  it('dọn thư mục tạm của job bị ngắt đột ngột (quá 12 giờ), giữ thư mục đang dùng', async () => {
    const { mkdirSync, existsSync, rmSync, utimesSync } = await import('node:fs');
    const root = process.env.WORKER_TMP_DIR ?? tmpdir();
    const old = join(root, `luna-video-stale-${Date.now()}`);
    const fresh = join(root, `luna-video-fresh-${Date.now()}`);
    mkdirSync(old);
    mkdirSync(fresh);
    const past = new Date(Date.now() - 13 * 3600_000);
    utimesSync(old, past, past);
    expect(await maintenance.cleanWorkDirs()).toBeGreaterThanOrEqual(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    rmSync(fresh, { recursive: true });
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
