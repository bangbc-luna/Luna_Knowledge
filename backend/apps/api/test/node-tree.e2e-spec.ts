import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ObjectStore, type JobQueue } from '@luna/shared';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('Node tree create, move and restore behaviour (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let wsId: string;
  let f: string;
  let seq = 0;
  let s3: S3Client;
  let buckets: ObjectStore['buckets'];
  let searchQueue: Queue;
  const http = () => request(ctx.app.getHttpServer());

  const createFolder = (
    as: LoggedIn,
    name: string,
    parentId: string | null = null,
    section?: 'DOCS' | 'VIDEOS',
  ) =>
    http()
      .post(`/api/v1/workspaces/${wsId}/folders`)
      .set(as.auth)
      .send({ name, parentId, section });
  const createDocument = (
    as: LoggedIn,
    name: string,
    parentId: string | null = null,
    format?: 'RICH' | 'LATEX',
  ) =>
    http()
      .post(`/api/v1/workspaces/${wsId}/documents`)
      .set(as.auth)
      .send({ name, parentId, format });
  const startUpload = (as: LoggedIn, body: Record<string, unknown>) =>
    http().post(`/api/v1/workspaces/${wsId}/uploads`).set(as.auth).send(body);
  const move = (as: LoggedIn, id: string, targetParentId: string | null) =>
    http().post(`/api/v1/nodes/${id}/move`).set(as.auth).send({ targetParentId });
  const trash = (as: LoggedIn, id: string) => http().delete(`/api/v1/nodes/${id}`).set(as.auth);
  const restore = (as: LoggedIn, id: string) =>
    http().post(`/api/v1/nodes/${id}/restore`).set(as.auth);

  const auditOf = (targetId: string) =>
    ctx.prisma.auditLog.findMany({ where: { targetId }, orderBy: { id: 'asc' } });
  const indexJobsFor = async (nodeId: string) =>
    (await searchQueue.getJobs(['waiting', 'delayed', 'prioritized']))
      .filter((j) => (j.data as { nodeId?: string }).nodeId === nodeId)
      .map((j) => j.name)
      .sort();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    s3 = ctx.app.get(ObjectStore).s3;
    buckets = ctx.app.get(ObjectStore).buckets;
    searchQueue = ctx.app.get<Queue & JobQueue<'search-index'>>(getQueueToken('search-index'));
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    wsId = (
      await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({ name: 'Tree', slug: 'tree' })
        .expect(201)
    ).body.id;
  });

  beforeEach(async () => {
    f = (await createFolder(alice, `Đích ${++seq}`).expect(201)).body.id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('tạo folder: đúng một dòng node.create {type, name, parentId} và một job index-node', async () => {
    const res = await createFolder(alice, 'Kế hoạch', f).expect(201);
    expect(res.body).toMatchObject({
      type: 'FOLDER',
      name: 'Kế hoạch',
      parentId: f,
      section: 'DOCS',
      status: 'READY',
      myRole: 'OWNER',
    });
    const id = res.body.id as string;
    const rows = await auditOf(id);
    expect(rows.map((r) => [r.action, r.targetType, r.metadata])).toEqual([
      ['node.create', 'node', { type: 'FOLDER', name: 'Kế hoạch', parentId: f }],
    ]);
    expect(await indexJobsFor(id)).toEqual(['index-node']);
  });

  it('tạo folder trùng tên: 409 kèm gợi ý, không thêm dòng audit', async () => {
    await createFolder(alice, 'Báo cáo', f).expect(201);
    const dup = await createFolder(alice, 'Báo cáo', f).expect(409);
    expect(dup.body.error.details.suggestion).toBe('Báo cáo (1)');
    expect(await ctx.prisma.node.count({ where: { parentId: f } })).toBe(1);
  });

  it('tạo tài liệu ở gốc: node.create kèm format, section lưu là DOCS, một job index-node', async () => {
    const res = await createDocument(alice, 'Ghi chú', null, 'LATEX').expect(201);
    expect(res.body.node).toMatchObject({
      type: 'DOCUMENT',
      name: 'Ghi chú',
      parentId: null,
      section: 'DOCS',
    });
    expect(res.body.format).toBe('LATEX');
    const id = res.body.node.id as string;
    const rows = await auditOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'node.create',
      targetType: 'node',
      metadata: { type: 'DOCUMENT', format: 'LATEX', name: 'Ghi chú', parentId: null },
    });
    expect((await ctx.prisma.node.findUniqueOrThrow({ where: { id } })).section).toBe('DOCS');
    expect(await indexJobsFor(id)).toEqual(['index-node']);
  });

  it('tạo tài liệu trùng tên: 409 kèm gợi ý', async () => {
    await createDocument(alice, 'Biên bản', f).expect(201);
    const dup = await createDocument(alice, 'Biên bản', f).expect(409);
    expect(dup.body.error.details.suggestion).toBe('Biên bản (1)');
  });

  it('sao chép tài liệu chỉ ghi document.copy, không ghi node.create', async () => {
    const src = (await createDocument(alice, 'Mẫu', f).expect(201)).body.node.id as string;
    const copy = await http()
      .post(`/api/v1/documents/${src}/copy`)
      .set(alice.auth)
      .send({})
      .expect(201);
    expect(copy.body.node).toMatchObject({ name: 'Mẫu (bản sao)', parentId: f });
    const id = copy.body.node.id as string;
    const rows = await auditOf(id);
    expect(rows.map((r) => r.action)).toEqual(['document.copy']);
    expect(rows[0]!.metadata).toEqual({
      name: 'Mẫu (bản sao)',
      parentId: f,
      fromNodeId: src,
      fromName: 'Mẫu',
      fromWorkspaceId: wsId,
    });
    expect(await indexJobsFor(id)).toEqual(['index-node']);
  });

  it('import .docx chỉ ghi document.import, không ghi node.create', async () => {
    const body = await readFile(`${FIXTURES}sample.docx`);
    const file = await ctx.prisma.node.create({
      data: {
        workspaceId: wsId,
        parentId: f,
        type: 'FILE',
        name: 'Onboarding.docx',
        nameNormalized: 'onboarding.docx',
        createdById: alice.userId,
      },
    });
    const key = `ws/${wsId}/${file.id}/v1`;
    await s3.send(new PutObjectCommand({ Bucket: buckets.originals, Key: key, Body: body }));
    const blob = await ctx.prisma.blob.create({
      data: {
        nodeId: file.id,
        kind: 'ORIGINAL',
        provider: 'S3',
        container: buckets.originals,
        key,
        sizeBytes: BigInt(body.length),
        mime: DOCX_MIME,
      },
    });
    const v = await ctx.prisma.fileVersion.create({
      data: {
        nodeId: file.id,
        versionNo: 1,
        fileName: 'Onboarding.docx',
        originalBlobId: blob.id,
        uploadedById: alice.userId,
      },
    });
    await ctx.prisma.fileInfo.create({ data: { nodeId: file.id, currentVersionId: v.id } });

    const res = await http()
      .post(`/api/v1/files/${file.id}/convert-to-document`)
      .set(alice.auth)
      .expect(201);
    expect(res.body.node).toMatchObject({
      type: 'DOCUMENT',
      name: 'Onboarding',
      parentId: f,
      section: 'DOCS',
    });
    const id = res.body.node.id as string;
    const rows = await auditOf(id);
    expect(rows.map((r) => r.action)).toEqual(['document.import']);
    expect(rows[0]).toMatchObject({
      targetType: 'node',
      metadata: { name: 'Onboarding', fromNodeId: file.id, fromName: 'Onboarding.docx' },
    });
    expect(await indexJobsFor(id)).toEqual(['index-node']);
  });

  it('bắt đầu upload: chỉ ghi upload.start, chưa đánh chỉ mục', async () => {
    const res = await startUpload(alice, { fileName: 'a.pdf', size: 10, parentId: f }).expect(201);
    const id = res.body.nodeId as string;
    const rows = await auditOf(id);
    expect(rows.map((r) => r.action)).toEqual(['upload.start']);
    expect(rows[0]).toMatchObject({
      targetType: 'node',
      metadata: { fileName: 'a.pdf', size: 10, newVersion: false },
    });
    expect(await indexJobsFor(id)).toEqual([]);
    await http().delete(`/api/v1/uploads/${res.body.uploadId}`).set(alice.auth).expect(204);
  });

  it('upload trùng tên trong folder: 409 kèm gợi ý, không để lại phiên upload', async () => {
    const first = await startUpload(alice, { fileName: 'b.pdf', size: 10, parentId: f }).expect(
      201,
    );
    const before = await ctx.prisma.uploadSession.count();
    const dup = await startUpload(alice, { fileName: 'b.pdf', size: 10, parentId: f }).expect(409);
    expect(dup.body.error.details.suggestion).toBe('b (1).pdf');
    expect(await ctx.prisma.uploadSession.count()).toBe(before);
    await http().delete(`/api/v1/uploads/${first.body.uploadId}`).set(alice.auth).expect(204);
  });

  describe('gốc DOCS và gốc VIDEOS có tập tên riêng', () => {
    const info = { title: 'Đào tạo', description: 'Video đào tạo' };
    const videoUpload = (extra: Record<string, unknown> = {}) =>
      startUpload(alice, {
        fileName: 'dao-tao.mp4',
        size: 10,
        mime: 'video/mp4',
        kind: 'VIDEO',
        ...info,
        ...extra,
      });
    const uploadIds: string[] = [];

    afterAll(async () => {
      for (const id of uploadIds) await http().delete(`/api/v1/uploads/${id}`).set(alice.auth);
    });

    it('video ở gốc VIDEOS trùng tên với mục ở gốc DOCS: không 409', async () => {
      await createFolder(alice, 'Đào tạo', null).expect(201);
      const res = await videoUpload().expect(201);
      uploadIds.push(res.body.uploadId);
      const node = await ctx.prisma.node.findUniqueOrThrow({ where: { id: res.body.nodeId } });
      expect(node).toMatchObject({ name: 'Đào tạo', section: 'VIDEOS', parentId: null });
    });

    it('video trùng tên trong gốc VIDEOS: 409 với gợi ý tính trong VIDEOS', async () => {
      const dup = await videoUpload({ fileName: 'dao-tao-2.mp4' }).expect(409);
      expect(dup.body.error.details.suggestion).toBe('Đào tạo (1)');
    });

    it('thư mục ở gốc VIDEOS không đụng tên với thư mục ở gốc DOCS, nhưng đụng nhau trong cùng khu', async () => {
      await createFolder(alice, 'Chung tên', null).expect(201);
      await createFolder(alice, 'Chung tên', null, 'VIDEOS').expect(201);
      const dup = await createFolder(alice, 'Chung tên', null, 'VIDEOS').expect(409);
      expect(dup.body.error.details.suggestion).toBe('Chung tên (1)');
    });
  });

  it('tài liệu vào folder thuộc VIDEOS: 400 với message khu Video', async () => {
    const vf = (await createFolder(alice, `Khu video ${seq}`, null, 'VIDEOS').expect(201)).body.id;
    const res = await createDocument(alice, 'Không vào được', vf).expect(400);
    expect(res.body.error.message).toBe(
      'This folder is in the Video area, which only holds videos',
    );
    expect(await ctx.prisma.node.count({ where: { parentId: vf } })).toBe(0);
  });

  it('di chuyển ghi node.move {from, to}; chuyển vào đúng cha hiện tại thì không ghi gì', async () => {
    const target = (await createFolder(alice, 'Nơi đến', f).expect(201)).body.id as string;
    const id = (await createFolder(alice, 'Cần chuyển', f).expect(201)).body.id as string;
    const moved = await move(alice, id, target).expect(200);
    expect(moved.body).toMatchObject({ id, parentId: target, name: 'Cần chuyển' });
    const same = await move(alice, id, target).expect(200);
    expect(same.body).toMatchObject({ id, parentId: target });
    const rows = await auditOf(id);
    expect(rows.map((r) => [r.action, r.metadata])).toEqual([
      ['node.create', { type: 'FOLDER', name: 'Cần chuyển', parentId: f }],
      ['node.move', { from: f, to: target }],
    ]);
    expect(await indexJobsFor(id)).toEqual(['index-node', 'index-tree']);
  });

  it('di chuyển trùng tên ở đích: 409 kèm gợi ý, không ghi node.move', async () => {
    const target = (await createFolder(alice, 'Đích trùng', f).expect(201)).body.id as string;
    await createFolder(alice, 'Trùng', target).expect(201);
    const id = (await createFolder(alice, 'Trùng', f).expect(201)).body.id as string;
    const res = await move(alice, id, target).expect(409);
    expect(res.body.error.details.suggestion).toBe('Trùng (1)');
    expect((await auditOf(id)).map((r) => r.action)).toEqual(['node.create']);
  });

  it('khôi phục phải đổi tên ghi node.restore {restoredTo, movedToRoot, renamedTo}', async () => {
    const x = (await createFolder(alice, 'X', f).expect(201)).body.id as string;
    await trash(alice, x).expect(204);
    await createFolder(alice, 'X', f).expect(201);
    const res = await restore(alice, x).expect(200);
    expect(res.body).toMatchObject({ name: 'X (1)', movedToRoot: false, renamed: true });
    expect(res.body.node).toMatchObject({ id: x, name: 'X (1)', parentId: f });
    const rows = await auditOf(x);
    expect(rows.map((r) => r.action)).toEqual(['node.create', 'node.trash', 'node.restore']);
    expect(rows[2]).toMatchObject({
      targetType: 'node',
      metadata: { restoredTo: f, movedToRoot: false, renamedTo: 'X (1)' },
    });
    expect(await indexJobsFor(x)).toContain('index-tree');
  });

  it('khôi phục khi cha đã bị xoá: về gốc, metadata không có renamedTo', async () => {
    const parent = (await createFolder(alice, 'Cha', f).expect(201)).body.id as string;
    const child = (await createFolder(alice, 'Con', parent).expect(201)).body.id as string;
    await trash(alice, child).expect(204);
    await trash(alice, parent).expect(204);
    const res = await restore(alice, child).expect(200);
    expect(res.body).toMatchObject({ name: 'Con', movedToRoot: true, renamed: false });
    expect(res.body.node.parentId).toBeNull();
    const row = (await auditOf(child)).find((r) => r.action === 'node.restore')!;
    expect(row.metadata).toEqual({ restoredTo: null, movedToRoot: true });
  });
});
