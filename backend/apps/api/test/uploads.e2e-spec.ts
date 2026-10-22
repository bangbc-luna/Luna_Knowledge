import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { QUEUES, redisConnection } from '@luna/shared';
import { Queue } from 'bullmq';
import request from 'supertest';
import { BUCKETS, type Buckets, S3 } from '../src/infra/s3/s3.module.js';
import { PART_SIZE } from '../src/files/uploads.service.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

const MB = 1024 * 1024;

describe('Uploads and files (e2e)', () => {
  let ctx: TestContext;
  let sysadmin: LoggedIn;
  let owner: LoggedIn;
  let editor: LoggedIn;
  let viewer: LoggedIn;
  let outsider: LoggedIn;
  let wsId: string;
  let s3: S3Client;
  let buckets: Buckets;
  let fileQueue: Queue;
  const http = () => request(ctx.app.getHttpServer());

  const startUpload = (as: LoggedIn, body: Record<string, unknown>) =>
    http().post(`/api/v1/workspaces/${wsId}/uploads`).set(as.auth).send(body);

  const createFolder = (as: LoggedIn, name: string, section?: 'DOCS' | 'VIDEOS') =>
    http().post(`/api/v1/workspaces/${wsId}/folders`).set(as.auth).send({ name, section });

  const shareToViewer = (as: LoggedIn, nodeId: string) =>
    http()
      .post(`/api/v1/nodes/${nodeId}/shares`)
      .set(as.auth)
      .send({ email: 'viewer@lunatech.vn', role: 'VIEWER' })
      .expect(201);

  const putPart = async (url: string, data: Buffer) => {
    const res = await fetch(url, { method: 'PUT', body: data });
    expect(res.status).toBe(200);
  };

  async function simulateProcessed(uploadId: string, mime = 'application/pdf') {
    const session = await ctx.prisma.uploadSession.findUniqueOrThrow({ where: { id: uploadId } });
    const content = Buffer.from(`content of ${session.fileName}`);
    const key = `ws/${session.workspaceId}/${session.nodeId}/${uploadId}`;
    await s3.send(new PutObjectCommand({ Bucket: buckets.originals, Key: key, Body: content }));
    await s3.send(
      new PutObjectCommand({ Bucket: buckets.previews, Key: `${key}.pdf`, Body: content }),
    );
    const blob = (kind: 'ORIGINAL' | 'PREVIEW', bucket: string, k: string) =>
      ctx.prisma.blob.create({
        data: {
          nodeId: session.nodeId,
          kind,
          provider: 'S3',
          container: bucket,
          key: k,
          sizeBytes: BigInt(content.length),
          mime,
        },
      });
    const original = await blob('ORIGINAL', buckets.originals, key);
    const preview = await blob('PREVIEW', buckets.previews, `${key}.pdf`);
    const count = await ctx.prisma.fileVersion.count({ where: { nodeId: session.nodeId } });
    await ctx.prisma.fileVersion.create({
      data: {
        id: uploadId,
        nodeId: session.nodeId,
        versionNo: count + 1,
        fileName: session.fileName,
        originalBlobId: original.id,
        previewBlobId: preview.id,
        previewKind: 'pdf',
        uploadedById: session.createdById,
      },
    });
    await ctx.prisma.fileInfo.upsert({
      where: { nodeId: session.nodeId },
      create: { nodeId: session.nodeId, currentVersionId: uploadId },
      update: { currentVersionId: uploadId },
    });
    await ctx.prisma.node.update({ where: { id: session.nodeId }, data: { status: 'READY' } });
    return { content, nodeId: session.nodeId };
  }

  async function uploadSmall(as: LoggedIn, fileName: string, extra: Record<string, unknown> = {}) {
    const data = Buffer.from(`hello ${fileName}`);
    const start = await startUpload(as, { fileName, size: data.length, ...extra }).expect(201);
    await putPart(start.body.parts[0].url, data);
    await http()
      .post(`/api/v1/uploads/${start.body.uploadId}/complete`)
      .set(as.auth)
      .send({})
      .expect(200);
    return { ...(await simulateProcessed(start.body.uploadId)), uploadId: start.body.uploadId };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    s3 = ctx.app.get(S3);
    buckets = ctx.app.get(BUCKETS);
    fileQueue = new Queue(QUEUES.FILE_PROCESS, {
      connection: redisConnection(process.env.REDIS_URL!),
      prefix: 'luna',
    });

    sysadmin = await loginAsAdmin(ctx);
    owner = await loginAs(ctx, 'owner@lunatech.vn');
    editor = await loginAs(ctx, 'editor@lunatech.vn');
    viewer = await loginAs(ctx, 'viewer@lunatech.vn');
    outsider = await loginAs(ctx, 'outsider@lunatech.vn');
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(owner.auth)
      .send({ name: 'Files', slug: 'files', memberEmails: ['editor@lunatech.vn'] })
      .expect(201);
    wsId = ws.body.id;
  });

  afterAll(async () => {
    await fileQueue?.close();
    await ctx?.close();
  });

  describe('khởi tạo upload', () => {
    it('chặn đuôi không cho phép, file quá lớn, video sai kind, người chỉ xem, người ngoài', async () => {
      const exe = await startUpload(editor, { fileName: 'setup.exe', size: 10 }).expect(415);
      expect(exe.body.error.code).toBe('UNSUPPORTED_TYPE');
      await startUpload(editor, { fileName: 'page.html', size: 10 }).expect(415);
      await startUpload(editor, { fileName: 'icon.svg', size: 10 }).expect(415);
      const big = await startUpload(editor, { fileName: 'big.pdf', size: 501 * MB }).expect(413);
      expect(big.body.error.code).toBe('TOO_LARGE');
      await startUpload(editor, { fileName: 'clip.mp4', size: 10 }).expect(400);
      await startUpload(editor, { fileName: 'doc.pdf', size: 10, kind: 'VIDEO' }).expect(400);
      const folder = (await createFolder(editor, 'Chỉ xem').expect(201)).body.id;
      await shareToViewer(owner, folder);
      await startUpload(viewer, { fileName: 'a.pdf', size: 10, parentId: folder }).expect(403);
      await startUpload(viewer, { fileName: 'a.pdf', size: 10 }).expect(404);
      await startUpload(outsider, { fileName: 'a.pdf', size: 10 }).expect(404);
    });

    it('video vào khu VIDEOS, file vào khu DOCS; sai khu → 400', async () => {
      const docsFolder = (await createFolder(editor, 'Tài liệu').expect(201)).body.id;
      const videosFolder = (await createFolder(editor, 'Video', 'VIDEOS').expect(201)).body.id;
      const video = await startUpload(editor, {
        fileName: 'intro.mp4',
        size: 10,
        kind: 'VIDEO',
      }).expect(201);
      const file = await startUpload(editor, { fileName: 'intro.pdf', size: 10 }).expect(201);
      const sectionOf = async (id: string) =>
        (await ctx.prisma.node.findUniqueOrThrow({ where: { id } })).section;
      expect(await sectionOf(video.body.nodeId)).toBe('VIDEOS');
      expect(await sectionOf(file.body.nodeId)).toBe('DOCS');
      const inVideos = await startUpload(editor, {
        fileName: 'clip.mp4',
        size: 10,
        kind: 'VIDEO',
        parentId: videosFolder,
      }).expect(201);
      expect(await sectionOf(inVideos.body.nodeId)).toBe('VIDEOS');
      await startUpload(editor, {
        fileName: 'clip.mp4',
        size: 10,
        kind: 'VIDEO',
        parentId: docsFolder,
      }).expect(400);
      await startUpload(editor, { fileName: 'a.pdf', size: 10, parentId: videosFolder }).expect(
        400,
      );
      await startUpload(editor, { fileName: 'a.pdf', size: 10, parentId: docsFolder }).expect(201);
      const videosRoot = await http()
        .get(`/api/v1/workspaces/${wsId}/nodes?section=VIDEOS`)
        .set(editor.auth)
        .expect(200);
      expect(videosRoot.body.items.map((n: { name: string }) => n.name)).toContain('intro.mp4');
      for (const id of [video.body.uploadId, file.body.uploadId, inVideos.body.uploadId])
        await http().delete(`/api/v1/uploads/${id}`).set(editor.auth).expect(204);
    });

    it('trùng tên trong folder → 409 kèm gợi ý', async () => {
      await startUpload(editor, { fileName: 'Báo cáo.pdf', size: 10 }).expect(201);
      const dup = await startUpload(editor, { fileName: 'báo cáo.PDF', size: 10 }).expect(409);
      expect(dup.body.error.details.suggestion).toBe('báo cáo (1).PDF');
    });

    it('mục đang tải lên chỉ người tải thấy trong danh sách', async () => {
      await startUpload(editor, { fileName: 'pending.pdf', size: 10 }).expect(201);
      const mine = await http()
        .get(`/api/v1/workspaces/${wsId}/nodes`)
        .set(editor.auth)
        .expect(200);
      const theirs = await http()
        .get(`/api/v1/workspaces/${wsId}/nodes`)
        .set(owner.auth)
        .expect(200);
      const names = (r: request.Response) => r.body.items.map((n: { name: string }) => n.name);
      expect(names(mine)).toContain('pending.pdf');
      expect(names(theirs)).not.toContain('pending.pdf');
    });
  });

  describe('multipart và tải tiếp', () => {
    it('file 3 part: mất kết nối giữa chừng, hỏi trạng thái rồi gửi tiếp phần còn thiếu', async () => {
      const size = 2 * PART_SIZE + 123;
      const data = Buffer.alloc(size, 7);
      const start = await startUpload(editor, { fileName: 'big.pdf', size }).expect(201);
      expect(start.body.partCount).toBe(3);
      expect(start.body.parts).toHaveLength(3);
      const { uploadId } = start.body;

      await putPart(start.body.parts[0].url, data.subarray(0, PART_SIZE));
      const missing = await http()
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set(editor.auth)
        .send({})
        .expect(400);
      expect(missing.body.error.details.missingParts).toEqual([2, 3]);

      const status = await http().get(`/api/v1/uploads/${uploadId}`).set(editor.auth).expect(200);
      expect(status.body.uploadedParts.map((p: { partNumber: number }) => p.partNumber)).toEqual([
        1,
      ]);
      expect(status.body.uploadedBytes).toBe(PART_SIZE);
      const more = await http()
        .get(`/api/v1/uploads/${uploadId}/parts?from=2`)
        .set(editor.auth)
        .expect(200);
      expect(more.body.parts.map((p: { partNumber: number }) => p.partNumber)).toEqual([2, 3]);
      await putPart(more.body.parts[0].url, data.subarray(PART_SIZE, 2 * PART_SIZE));
      await putPart(more.body.parts[1].url, data.subarray(2 * PART_SIZE));

      const done = await http()
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set(editor.auth)
        .send({})
        .expect(200);
      expect(done.body.status).toBe('COMPLETED');
      const node = await ctx.prisma.node.findUniqueOrThrow({ where: { id: done.body.nodeId } });
      expect(node.status).toBe('PROCESSING');
      const job = await fileQueue.getJob(`upload-${uploadId}`);
      expect(job?.data).toEqual({ uploadId });

      await http()
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set(editor.auth)
        .send({})
        .expect(200);
      await http().get(`/api/v1/uploads/${uploadId}/parts`).set(editor.auth).expect(409);
    });

    it('kích thước thực tế khác khai báo → 400', async () => {
      const start = await startUpload(editor, { fileName: 'liar.txt', size: 100 }).expect(201);
      await putPart(start.body.parts[0].url, Buffer.alloc(50, 1));
      const res = await http()
        .post(`/api/v1/uploads/${start.body.uploadId}/complete`)
        .set(editor.auth)
        .send({})
        .expect(400);
      expect(res.body.error.details).toEqual({ declared: 100, received: 50 });
    });

    it('chỉ người tạo thấy upload; hủy upload xóa mục đang chờ', async () => {
      const start = await startUpload(editor, { fileName: 'draft.txt', size: 10 }).expect(201);
      const { uploadId, nodeId } = start.body;
      await http().get(`/api/v1/uploads/${uploadId}`).set(owner.auth).expect(404);
      await http().delete(`/api/v1/uploads/${uploadId}`).set(owner.auth).expect(404);
      await http().delete(`/api/v1/uploads/${uploadId}`).set(editor.auth).expect(204);
      expect(await ctx.prisma.node.findUnique({ where: { id: nodeId } })).toBeNull();
    });

    it('quyền bị thu hồi trong lúc tải → không hoàn tất được', async () => {
      const temp = await loginAs(ctx, 'temp@lunatech.vn');
      const member = await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(sysadmin.auth)
        .send({ email: 'temp@lunatech.vn' })
        .expect(201);
      const start = await startUpload(temp, { fileName: 'temp.txt', size: 5 }).expect(201);
      await putPart(start.body.parts[0].url, Buffer.from('12345'));
      await http()
        .delete(`/api/v1/workspaces/${wsId}/members/${member.body.user.id}`)
        .set(sysadmin.auth)
        .expect(204);
      await http()
        .post(`/api/v1/uploads/${start.body.uploadId}/complete`)
        .set(temp.auth)
        .send({})
        .expect(404);
    });
  });

  describe('xem trước, tải về, phiên bản', () => {
    let nodeId: string;
    let content: Buffer;

    beforeAll(async () => {
      ({ nodeId, content } = await uploadSmall(editor, 'Hợp đồng mẫu.pdf'));
      await shareToViewer(owner, nodeId);
    });

    it('chi tiết file và URL xem trước ký sẵn', async () => {
      const detail = await http().get(`/api/v1/files/${nodeId}`).set(viewer.auth).expect(200);
      expect(detail.body.node.status).toBe('READY');
      expect(detail.body.currentVersion).toMatchObject({ versionNo: 1, previewKind: 'pdf' });
      expect(detail.body.canDownload).toBe(true);
      const list = await http().get(`/api/v1/workspaces/${wsId}/nodes`).set(owner.auth).expect(200);
      const row = list.body.items.find((n: { id: string }) => n.id === nodeId);
      expect(row).toMatchObject({ size: content.length, mime: 'application/pdf' });

      const preview = await http()
        .get(`/api/v1/files/${nodeId}/preview`)
        .set(viewer.auth)
        .expect(200);
      expect(preview.body.kind).toBe('pdf');
      const res = await fetch(preview.body.url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toContain('inline');
    });

    it('tải file gốc qua API, ghi nhật ký; người ngoài 404', async () => {
      const res = await http().get(`/api/v1/files/${nodeId}/download`).set(viewer.auth).expect(200);
      expect(
        Buffer.from(res.body as Buffer).equals(content) || res.text === content.toString(),
      ).toBe(true);
      expect(res.headers['content-disposition']).toContain(
        `filename*=UTF-8''${encodeURIComponent('Hợp đồng mẫu.pdf')}`,
      );
      expect(res.headers['content-disposition']).toContain('filename="Hop dong mau.pdf"');
      const log = await ctx.prisma.auditLog.findFirst({
        where: { action: 'file.download', targetId: nodeId },
      });
      expect(log?.actorId).toBe(viewer.userId);
      await http().get(`/api/v1/files/${nodeId}/download`).set(outsider.auth).expect(404);
    });

    it('link tải dùng một lần', async () => {
      const link = await http()
        .post(`/api/v1/files/${nodeId}/download-link`)
        .set(viewer.auth)
        .expect(201);
      expect(link.body.url).toMatch(/^\/api\/v1\/downloads\//);
      await http().get(link.body.url).expect(200);
      await http().get(link.body.url).expect(404);
    });

    it('phiên bản mới, lịch sử, khôi phục bản cũ', async () => {
      await uploadSmall(editor, 'v2.pdf', { replaceNodeId: nodeId });
      const versions = await http()
        .get(`/api/v1/files/${nodeId}/versions`)
        .set(viewer.auth)
        .expect(200);
      expect(versions.body.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
      expect(versions.body[0].isCurrent).toBe(true);
      const node = await ctx.prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
      expect(node.name).toBe('Hợp đồng mẫu.pdf');

      const v1 = versions.body[1].id;
      await http()
        .post(`/api/v1/files/${nodeId}/versions/${v1}/restore`)
        .set(viewer.auth)
        .expect(403);
      const restored = await http()
        .post(`/api/v1/files/${nodeId}/versions/${v1}/restore`)
        .set(owner.auth)
        .expect(200);
      expect(restored.body.currentVersion.versionNo).toBe(1);
      const old = await http()
        .get(`/api/v1/files/${nodeId}/download?version=${versions.body[0].id}`)
        .set(editor.auth)
        .expect(200);
      expect(old.headers['content-disposition']).toContain('attachment');
    });

    it('không upload phiên bản mới khi đang có upload chờ', async () => {
      await startUpload(editor, { fileName: 'v3.pdf', size: 10, replaceNodeId: nodeId }).expect(
        201,
      );
      await startUpload(editor, { fileName: 'v4.pdf', size: 10, replaceNodeId: nodeId }).expect(
        409,
      );
    });

    it('video không được tải về', async () => {
      const start = await startUpload(editor, {
        fileName: 'demo.mp4',
        size: 5,
        kind: 'VIDEO',
      }).expect(201);
      await putPart(start.body.parts[0].url, Buffer.from('video'));
      await http()
        .post(`/api/v1/uploads/${start.body.uploadId}/complete`)
        .set(editor.auth)
        .send({})
        .expect(200);
      await simulateProcessed(start.body.uploadId, 'video/mp4');
      await shareToViewer(owner, start.body.nodeId);
      const detail = await http()
        .get(`/api/v1/files/${start.body.nodeId}`)
        .set(viewer.auth)
        .expect(200);
      expect(detail.body.canDownload).toBe(false);
      await http().get(`/api/v1/files/${start.body.nodeId}/download`).set(owner.auth).expect(403);
      await http()
        .post(`/api/v1/files/${start.body.nodeId}/download-link`)
        .set(owner.auth)
        .expect(403);
    });

    it('dung lượng workspace', async () => {
      const res = await http()
        .get(`/api/v1/workspaces/${wsId}/storage`)
        .set(owner.auth)
        .expect(200);
      expect(res.body.originalBytes).toBeGreaterThan(0);
      expect(res.body.totalBytes).toBe(res.body.originalBytes + res.body.derivedBytes);
      await http().get(`/api/v1/workspaces/${wsId}/storage`).set(outsider.auth).expect(404);
      await http().get(`/api/v1/workspaces/${wsId}/storage`).set(viewer.auth).expect(404);
    });

    it('xóa vĩnh viễn (quản trị workspace): blob được đưa vào hàng đợi dọn object', async () => {
      const keys = await ctx.prisma.blob.findMany({ where: { nodeId }, select: { key: true } });
      expect(keys.length).toBeGreaterThan(0);
      await http().delete(`/api/v1/nodes/${nodeId}`).set(viewer.auth).expect(403);
      await http().delete(`/api/v1/nodes/${nodeId}`).set(editor.auth).expect(204);
      await http().delete(`/api/v1/nodes/${nodeId}/permanent`).set(editor.auth).expect(403);
      await http().delete(`/api/v1/nodes/${nodeId}/permanent`).set(owner.auth).expect(204);
      const queued = await ctx.prisma.blobGc.findMany({
        where: { key: { in: keys.map((k) => k.key) } },
      });
      expect(queued).toHaveLength(keys.length);
    });
  });
});
