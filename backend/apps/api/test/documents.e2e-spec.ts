import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  type DocJSON,
  jsonToState,
  jsonToText,
  LATEX_TEMPLATE,
  latexJSON,
  stateToJSON,
} from '@luna/editor';
import { COLLAB_ACCESS_CHANNEL, COLLAB_TOKEN_AUDIENCE } from '@luna/shared';
import { Redis } from 'ioredis';
import { jwtVerify } from 'jose';
import request from 'supertest';
import { CollabClient } from '../src/documents/collab-client.service.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { BUCKETS, type Buckets, S3 } from '../src/infra/s3/s3.module.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const para = (text: string): DocJSON => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

class FakeCollab {
  prisma!: PrismaService;
  async snapshot(nodeId: string) {
    const row = await this.prisma.client.document.findUniqueOrThrow({ where: { nodeId } });
    return new Uint8Array(row.yjsState!);
  }
  async replace(nodeId: string, _ws: string, _actor: string, json: DocJSON) {
    const state = jsonToState(json);
    await this.prisma.client.document.update({
      where: { nodeId },
      data: {
        yjsState: new Uint8Array(state),
        contentJson: json as object,
        contentText: jsonToText(json),
      },
    });
    return state;
  }
}

describe('Documents, versions, comments, notifications (e2e)', () => {
  const collab = new FakeCollab();
  let ctx: TestContext;
  let admin: LoggedIn;
  let owner: LoggedIn;
  let editor: LoggedIn;
  let viewer: LoggedIn;
  let outsider: LoggedIn;
  let wsId: string;
  let s3: S3Client;
  let buckets: Buckets;
  const http = () => request(ctx.app.getHttpServer());
  const create = (as: LoggedIn, name: string, parentId?: string) =>
    http().post(`/api/v1/workspaces/${wsId}/documents`).set(as.auth).send({ name, parentId });
  const shareToViewer = (as: LoggedIn, nodeId: string) =>
    http()
      .post(`/api/v1/nodes/${nodeId}/shares`)
      .set(as.auth)
      .send({ email: 'viewer@lunatech.vn', role: 'VIEWER' })
      .expect(201);
  const createShared = async (as: LoggedIn, name: string) => {
    const id = (await create(as, name).expect(201)).body.node.id as string;
    await shareToViewer(owner, id);
    return id;
  };
  const setContent = (nodeId: string, json: DocJSON) =>
    ctx.prisma.document.update({
      where: { nodeId },
      data: {
        yjsState: new Uint8Array(jsonToState(json)),
        contentJson: json as object,
        contentText: jsonToText(json),
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp([[CollabClient, collab]]);
    collab.prisma = ctx.app.get(PrismaService);
    await resetDatabase(ctx.prisma);
    s3 = ctx.app.get(S3);
    buckets = ctx.app.get(BUCKETS);
    admin = await loginAsAdmin(ctx);
    owner = await loginAs(ctx, 'owner@lunatech.vn', { name: 'Chủ Tài Liệu' });
    editor = await loginAs(ctx, 'editor@lunatech.vn', { name: 'Biên Tập' });
    viewer = await loginAs(ctx, 'viewer@lunatech.vn', { name: 'Người Xem' });
    outsider = await loginAs(ctx, 'outsider@lunatech.vn');
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(owner.auth)
      .send({ name: 'Docs', slug: 'docs', memberEmails: ['editor@lunatech.vn'] })
      .expect(201);
    wsId = ws.body.id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('tạo tài liệu trống (thành viên là EDITOR, không thành OWNER); người chỉ xem không tạo được; trùng tên có gợi ý', async () => {
    const res = await create(editor, 'Biên bản họp').expect(201);
    expect(res.body.node).toMatchObject({
      type: 'DOCUMENT',
      name: 'Biên bản họp',
      section: 'DOCS',
      myRole: 'EDITOR',
    });
    await http()
      .post(`/api/v1/nodes/${res.body.node.id}/shares`)
      .set(editor.auth)
      .send({ email: 'viewer@lunatech.vn', role: 'VIEWER' })
      .expect(403);
    expect(res.body.wordCount).toBe(0);
    expect(res.body.contentJson).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    const folder = (
      await http()
        .post(`/api/v1/workspaces/${wsId}/folders`)
        .set(owner.auth)
        .send({ name: 'Chỉ xem' })
        .expect(201)
    ).body.id;
    await shareToViewer(owner, folder);
    await create(viewer, 'Không được', folder).expect(403);
    await create(viewer, 'Không được').expect(404);
    await create(outsider, 'Không được').expect(404);
    const dup = await create(editor, 'biên bản họp').expect(409);
    expect(dup.body.error.details.suggestion).toBe('biên bản họp (1)');
  });

  it('tài liệu LaTeX: tạo có khung mẫu, xuất .tex, sao chép giữ loại, khôi phục phiên bản, chưa có bình luận', async () => {
    const res = await http()
      .post(`/api/v1/workspaces/${wsId}/documents`)
      .set(editor.auth)
      .send({ name: 'Công thức tài chính', format: 'LATEX' })
      .expect(201);
    const id = res.body.node.id as string;
    expect(res.body.format).toBe('LATEX');
    expect(res.body.contentJson).toEqual(latexJSON(LATEX_TEMPLATE));
    expect(res.body.node.documentFormat).toBe('LATEX');
    expect(res.body.wordCount).toBeGreaterThan(0);
    await shareToViewer(owner, id);
    await http()
      .post(`/api/v1/workspaces/${wsId}/documents`)
      .set(editor.auth)
      .send({ name: 'Sai loại', format: 'PDF' })
      .expect(400);

    const source = String.raw`\section{Lãi kép}
$A = P(1 + r)^n$`;
    await setContent(id, latexJSON(source));
    const tex = await http()
      .get(`/api/v1/documents/${id}/export?format=tex`)
      .set(viewer.auth)
      .expect(200);
    expect(tex.headers['content-type']).toContain('application/x-tex');
    expect(tex.headers['content-disposition']).toContain('.tex');
    expect(tex.text).toBe(source);
    const rich = (await create(editor, 'Văn bản thường').expect(201)).body;
    expect(rich.format).toBe('RICH');
    expect(rich.node.documentFormat).toBe('RICH');
    await http()
      .get(`/api/v1/documents/${rich.node.id}/export?format=tex`)
      .set(editor.auth)
      .expect(400);

    const v1 = await http()
      .post(`/api/v1/documents/${id}/versions`)
      .set(editor.auth)
      .send({ name: 'Bản đầu' })
      .expect(201);
    await setContent(id, latexJSON('\\section{Đã sửa}'));
    const shown = await http()
      .get(`/api/v1/documents/${id}/versions/${v1.body.id}`)
      .set(viewer.auth)
      .expect(200);
    expect(shown.body.contentJson).toEqual(latexJSON(source));
    await http()
      .post(`/api/v1/documents/${id}/versions/${v1.body.id}/restore`)
      .set(editor.auth)
      .expect(200);
    const restored = await http().get(`/api/v1/documents/${id}`).set(editor.auth).expect(200);
    expect(restored.body.contentJson).toEqual(latexJSON(source));

    const copy = await http()
      .post(`/api/v1/documents/${id}/copy`)
      .set(editor.auth)
      .send({})
      .expect(201);
    expect(copy.body.format).toBe('LATEX');
    expect(copy.body.contentJson).toEqual(latexJSON(source));
    const copyRow = await ctx.prisma.document.findUniqueOrThrow({
      where: { nodeId: copy.body.node.id },
    });
    expect(stateToJSON(new Uint8Array(copyRow.yjsState!))).toEqual(latexJSON(source));
    expect(copyRow.contentText).toBe('Lãi kép\nA = P(1 + r) n');

    await http()
      .post(`/api/v1/documents/${id}/threads`)
      .set(editor.auth)
      .send({ quotedText: 'Lãi kép', body: 'Kiểm tra lại', mentions: [] })
      .expect(400);
  });

  it('tài liệu chỉ nằm ở khu DOCS: folder cha thuộc VIDEOS → 400', async () => {
    const videos = (
      await http()
        .post(`/api/v1/workspaces/${wsId}/folders`)
        .set(editor.auth)
        .send({ name: 'Video', section: 'VIDEOS' })
        .expect(201)
    ).body.id;
    const res = await create(editor, 'Ghi chú', videos).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('xem tài liệu: người được share chỉ xem chỉ đọc, thành viên và quản trị sửa được, người ngoài 404, ghi lượt xem', async () => {
    const id = await createShared(editor, 'Quy trình');
    await setContent(id, para('Nội dung quy trình'));
    const v = await http().get(`/api/v1/documents/${id}`).set(viewer.auth).expect(200);
    expect(v.body.readOnly).toBe(true);
    expect(jsonToText(v.body.contentJson)).toBe('Nội dung quy trình');
    const asMember = await http().get(`/api/v1/documents/${id}`).set(editor.auth).expect(200);
    expect(asMember.body.readOnly).toBe(false);
    expect(asMember.body.node.myRole).toBe('EDITOR');
    const asAdmin = await http().get(`/api/v1/documents/${id}`).set(owner.auth).expect(200);
    expect(asAdmin.body.readOnly).toBe(false);
    expect(asAdmin.body.node.myRole).toBe('OWNER');
    await http().get(`/api/v1/documents/${id}`).set(outsider.auth).expect(404);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'node.view', targetId: id } }),
    ).toBeGreaterThan(0);
  });

  it('collab token: JWT 5 phút cho đúng tài liệu, đúng người; người chỉ xem chỉ đọc', async () => {
    const id = await createShared(editor, 'Token');
    const t = await http().get(`/api/v1/documents/${id}/collab-token`).set(viewer.auth).expect(200);
    expect(t.body).toMatchObject({ documentName: `doc:${id}`, readOnly: true });
    const { payload } = await jwtVerify(
      t.body.token,
      new TextEncoder().encode(process.env.COLLAB_TOKEN_SECRET!),
      { audience: COLLAB_TOKEN_AUDIENCE, issuer: 'luna-api' },
    );
    expect(payload).toMatchObject({ sub: viewer.userId, doc: id });
    expect(payload.exp! - payload.iat!).toBe(300);
    const m = await http().get(`/api/v1/documents/${id}/collab-token`).set(owner.auth).expect(200);
    expect(m.body.readOnly).toBe(false);
    await http().get(`/api/v1/documents/${id}/collab-token`).set(outsider.auth).expect(404);
  });

  it('xuất HTML và Markdown (ghi nhật ký)', async () => {
    const id = await createShared(editor, 'Xuất bản');
    await setContent(id, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Tiêu đề' }] },
        ...para('Đoạn văn').content!,
      ],
    });
    const html = await http()
      .get(`/api/v1/documents/${id}/export?format=html`)
      .set(viewer.auth)
      .expect(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('<h1>Tiêu đề</h1>');
    expect(html.headers['content-disposition']).toContain('Xu');
    const md = await http()
      .get(`/api/v1/documents/${id}/export?format=md`)
      .set(viewer.auth)
      .expect(200);
    expect(md.text).toMatch(/^# Tiêu đề/);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'document.export', targetId: id } }),
    ).toBe(2);
  });

  it('ảnh nhúng: kiểm loại thật, giới hạn cỡ, URL ký mới mỗi lần đọc', async () => {
    const id = await createShared(editor, 'Có ảnh');
    const up = await http()
      .post(`/api/v1/documents/${id}/assets`)
      .set(editor.auth)
      .attach('file', PNG_1PX, 'logo.png')
      .expect(201);
    expect(up.body).toMatchObject({ fileName: 'logo.png', mime: 'image/png', isImage: true });
    expect((await fetch(up.body.url)).status).toBe(200);
    await http()
      .post(`/api/v1/documents/${id}/assets`)
      .set(viewer.auth)
      .attach('file', PNG_1PX, 'x.png')
      .expect(403);
    const exe = await http()
      .post(`/api/v1/documents/${id}/assets`)
      .set(editor.auth)
      .attach('file', await readFile(`${FIXTURES}fake-exe.pdf`), 'a.pdf')
      .expect(415);
    expect(exe.body.error.code).toBe('UNSUPPORTED_TYPE');
    await http()
      .post(`/api/v1/documents/${id}/assets`)
      .set(editor.auth)
      .attach('file', Buffer.alloc(21 * 1024 * 1024), 'big.png')
      .expect(413);

    await setContent(id, {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://stale.example/x', assetId: up.body.id } }],
    });
    const doc = await http().get(`/api/v1/documents/${id}`).set(viewer.auth).expect(200);
    const src = doc.body.contentJson.content[0].attrs.src as string;
    expect(src).toContain('X-Amz-Signature');
    expect(src).not.toContain('stale.example');
    const list = await http().get(`/api/v1/documents/${id}/assets`).set(viewer.auth).expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([up.body.id]);
  });

  it('phiên bản: lưu có tên, xem, so sánh, khôi phục tạo phiên bản mới', async () => {
    const id = await createShared(editor, 'Phiên bản');
    await setContent(id, para('Bản một của tài liệu'));
    const v1 = await http()
      .post(`/api/v1/documents/${id}/versions`)
      .set(editor.auth)
      .send({ name: 'Bản nháp' })
      .expect(201);
    expect(v1.body).toMatchObject({ versionNo: 1, name: 'Bản nháp', isAuto: false });
    expect(
      await ctx.prisma.documentVersion.findUniqueOrThrow({ where: { id: v1.body.id } }),
    ).toMatchObject({ wordsAdded: 5, wordsRemoved: 0 });
    await http()
      .post(`/api/v1/documents/${id}/versions`)
      .set(viewer.auth)
      .send({ name: 'x' })
      .expect(403);

    await setContent(id, para('Bản hai của tài liệu đã sửa'));
    const got = await http()
      .get(`/api/v1/documents/${id}/versions/${v1.body.id}`)
      .set(viewer.auth)
      .expect(200);
    expect(got.body.html).toContain('Bản một của tài liệu');
    const diff = await http()
      .get(`/api/v1/documents/${id}/versions/${v1.body.id}/diff?with=current`)
      .set(viewer.auth)
      .expect(200);
    expect(diff.body.stats).toEqual({ added: 3, removed: 1 });
    expect(
      diff.body.parts.some(
        (p: { type: string; text: string }) => p.type === 'removed' && p.text.includes('một'),
      ),
    ).toBe(true);

    await http()
      .post(`/api/v1/documents/${id}/versions/${v1.body.id}/restore`)
      .set(viewer.auth)
      .expect(403);
    const restored = await http()
      .post(`/api/v1/documents/${id}/versions/${v1.body.id}/restore`)
      .set(editor.auth)
      .expect(200);
    expect(restored.body).toMatchObject({
      versionNo: 2,
      name: 'Khôi phục từ phiên bản 1',
      restoredFrom: { id: v1.body.id, versionNo: 1 },
    });
    expect(
      await ctx.prisma.documentVersion.findUniqueOrThrow({ where: { id: restored.body.id } }),
    ).toMatchObject({ wordsAdded: 0, wordsRemoved: 0 });
    await setContent(id, para('Bản ba thêm vài chữ mới'));
    const v3 = await http()
      .post(`/api/v1/documents/${id}/versions`)
      .set(owner.auth)
      .send({ name: 'Bản ba' })
      .expect(201);
    expect(
      await ctx.prisma.documentVersion.findUniqueOrThrow({ where: { id: v3.body.id } }),
    ).toMatchObject({ wordsAdded: 5, wordsRemoved: 4 });
    await http()
      .post(`/api/v1/documents/${id}/versions/${v1.body.id}/restore`)
      .set(owner.auth)
      .expect(200);
    const now = await ctx.prisma.document.findUniqueOrThrow({ where: { nodeId: id } });
    expect(jsonToText(stateToJSON(now.yjsState!))).toBe('Bản một của tài liệu');
    const list = await http().get(`/api/v1/documents/${id}/versions`).set(viewer.auth).expect(200);
    expect(list.body.map((v: { versionNo: number }) => v.versionNo)).toEqual([4, 3, 2, 1]);
    const between = await http()
      .get(`/api/v1/documents/${id}/versions/${v1.body.id}/diff?with=${restored.body.id}`)
      .set(viewer.auth)
      .expect(200);
    expect(between.body.stats).toEqual({ added: 0, removed: 0 });
  });

  it('comment: @mention người xem được, bỏ người ngoài; thông báo; quyền sửa/xoá/resolve', async () => {
    const id = await createShared(owner, 'Thảo luận');
    await http()
      .post(`/api/v1/me/notifications/read`)
      .set(viewer.auth)
      .send({ all: true })
      .expect(200);
    const t = await http()
      .post(`/api/v1/documents/${id}/threads`)
      .set(editor.auth)
      .send({
        quotedText: 'đoạn này',
        body: 'Nhờ @Người Xem xem lại',
        mentions: [viewer.userId, outsider.userId],
      })
      .expect(201);
    expect(t.body.ignoredMentions).toEqual([outsider.userId]);
    expect(t.body.comments[0].mentions.map((m: { id: string }) => m.id)).toEqual([viewer.userId]);

    const vn = await http()
      .get('/api/v1/me/notifications?unread=true')
      .set(viewer.auth)
      .expect(200);
    expect(vn.body.unreadCount).toBe(1);
    expect(vn.body.items[0]).toMatchObject({
      type: 'comment.mention',
      payload: { nodeId: id, threadId: t.body.id, byName: 'Biên Tập' },
    });
    const on = await http().get('/api/v1/me/notifications').set(owner.auth).expect(200);
    expect(on.body.items.map((n: { type: string }) => n.type)).toContain('comment.new');
    expect(
      (await http().get('/api/v1/me/notifications').set(outsider.auth).expect(200)).body.items,
    ).toHaveLength(0);

    await http()
      .post(`/api/v1/me/notifications/read`)
      .set(viewer.auth)
      .send({ all: true })
      .expect(200);
    expect(
      (await http().get('/api/v1/me/notifications?unread=true').set(viewer.auth)).body.unreadCount,
    ).toBe(0);

    const reply = await http()
      .post(`/api/v1/threads/${t.body.id}/comments`)
      .set(viewer.auth)
      .send({ body: 'Đã xem' })
      .expect(201);
    expect(reply.body.comments).toHaveLength(2);
    const mine = reply.body.comments[1];
    expect(mine.canEdit).toBe(true);
    await http()
      .patch(`/api/v1/comments/${mine.id}`)
      .set(editor.auth)
      .send({ body: 'sửa hộ' })
      .expect(403);
    const edited = await http()
      .patch(`/api/v1/comments/${mine.id}`)
      .set(viewer.auth)
      .send({ body: 'Đã xem kỹ' })
      .expect(200);
    expect(edited.body.comments[1]).toMatchObject({ body: 'Đã xem kỹ' });

    await http().post(`/api/v1/threads/${t.body.id}/resolve`).set(viewer.auth).expect(403);
    const resolved = await http()
      .post(`/api/v1/threads/${t.body.id}/resolve`)
      .set(editor.auth)
      .expect(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(
      (await http().get(`/api/v1/documents/${id}/threads`).set(viewer.auth)).body,
    ).toHaveLength(0);
    expect(
      (await http().get(`/api/v1/documents/${id}/threads?status=RESOLVED`).set(viewer.auth)).body,
    ).toHaveLength(1);
    const reopened = await http()
      .post(`/api/v1/threads/${t.body.id}/comments`)
      .set(viewer.auth)
      .send({ body: 'Còn một chỗ' })
      .expect(201);
    expect(reopened.body.status).toBe('OPEN');

    await http().delete(`/api/v1/comments/${mine.id}`).set(editor.auth).expect(403);
    await http().delete(`/api/v1/comments/${mine.id}`).set(owner.auth).expect(200);
    const own = await http()
      .post(`/api/v1/threads/${t.body.id}/comments`)
      .set(viewer.auth)
      .send({ body: 'Tự xoá' })
      .expect(201);
    const ownId = own.body.comments[own.body.comments.length - 1].id;
    await http().delete(`/api/v1/comments/${ownId}`).set(viewer.auth).expect(200);

    const vt = await http()
      .post(`/api/v1/documents/${id}/threads`)
      .set(viewer.auth)
      .send({ body: 'Câu hỏi của người xem' })
      .expect(201);
    await http().post(`/api/v1/threads/${vt.body.id}/resolve`).set(viewer.auth).expect(200);
    await http()
      .post(`/api/v1/documents/${id}/threads`)
      .set(outsider.auth)
      .send({ body: 'x' })
      .expect(404);
  });

  it('chia sẻ cho người khác tạo thông báo share.added', async () => {
    const id = (await create(owner, 'Chia sẻ')).body.node.id;
    await http()
      .post(`/api/v1/nodes/${id}/shares`)
      .set(owner.auth)
      .send({ email: 'outsider@lunatech.vn', role: 'VIEWER' })
      .expect(201);
    const n = await http().get('/api/v1/me/notifications').set(outsider.auth).expect(200);
    expect(n.body.items[0]).toMatchObject({
      type: 'share.added',
      payload: { nodeId: id, role: 'VIEWER' },
    });
    await http().get(`/api/v1/documents/${id}`).set(outsider.auth).expect(200);
  });

  it('import .docx thành tài liệu soạn thảo được, cùng thư mục', async () => {
    const folder = (
      await http()
        .post(`/api/v1/workspaces/${wsId}/folders`)
        .set(editor.auth)
        .send({ name: 'Nhập' })
        .expect(201)
    ).body.id;
    await shareToViewer(owner, folder);
    const node = await ctx.prisma.node.create({
      data: {
        workspaceId: wsId,
        parentId: folder,
        type: 'FILE',
        name: 'Onboarding.docx',
        nameNormalized: 'onboarding.docx',
        createdById: editor.userId,
      },
    });
    const body = await readFile(`${FIXTURES}sample.docx`);
    const key = `ws/${wsId}/${node.id}/v1`;
    await s3.send(new PutObjectCommand({ Bucket: buckets.originals, Key: key, Body: body }));
    const blob = await ctx.prisma.blob.create({
      data: {
        nodeId: node.id,
        kind: 'ORIGINAL',
        provider: 'S3',
        container: buckets.originals,
        key,
        sizeBytes: BigInt(body.length),
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    });
    const v = await ctx.prisma.fileVersion.create({
      data: {
        nodeId: node.id,
        versionNo: 1,
        fileName: 'Onboarding.docx',
        originalBlobId: blob.id,
        uploadedById: editor.userId,
      },
    });
    await ctx.prisma.fileInfo.create({ data: { nodeId: node.id, currentVersionId: v.id } });

    await http().post(`/api/v1/files/${node.id}/convert-to-document`).set(viewer.auth).expect(403);
    const res = await http()
      .post(`/api/v1/files/${node.id}/convert-to-document`)
      .set(editor.auth)
      .expect(201);
    expect(res.body.node).toMatchObject({
      type: 'DOCUMENT',
      name: 'Onboarding',
      parentId: folder,
      section: 'DOCS',
    });
    expect(jsonToText(res.body.contentJson)).toContain('Quy trình onboarding Lunatech');
    expect(res.body.wordCount).toBeGreaterThan(5);
    const again = await http()
      .post(`/api/v1/files/${node.id}/convert-to-document`)
      .set(editor.auth)
      .expect(201);
    expect(again.body.node.name).toBe('Onboarding (1)');

    const pdf = await ctx.prisma.node.create({
      data: {
        workspaceId: wsId,
        type: 'FILE',
        name: 'a.pdf',
        nameNormalized: 'a.pdf',
        createdById: editor.userId,
      },
    });
    await http().post(`/api/v1/files/${pdf.id}/convert-to-document`).set(editor.auth).expect(415);
  });

  it('sao chép tài liệu: nội dung mới nhất và ảnh nhúng, không chép phiên bản; sang workspace khác; quyền', async () => {
    const id = await createShared(editor, 'Mẫu hợp đồng');
    const img = await http()
      .post(`/api/v1/documents/${id}/assets`)
      .set(editor.auth)
      .attach('file', PNG_1PX, 'logo.png')
      .expect(201);
    const json: DocJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Điều khoản thanh toán',
              marks: [{ type: 'bold' }, { type: 'comment', attrs: { threadId: 't1' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: img.body.url, assetId: img.body.id } },
      ],
    };
    await setContent(id, json);
    await http()
      .post(`/api/v1/documents/${id}/versions`)
      .set(editor.auth)
      .send({ name: 'v1' })
      .expect(201);

    const copy = await http()
      .post(`/api/v1/documents/${id}/copy`)
      .set(editor.auth)
      .send({})
      .expect(201);
    expect(copy.body.node).toMatchObject({ name: 'Mẫu hợp đồng (bản sao)', myRole: 'EDITOR' });
    expect(copy.body.node.id).not.toBe(id);
    expect(copy.body.versionCount).toBe(0);
    expect(copy.body.wordCount).toBe(4);
    expect(
      copy.body.contentJson.content[0].content[0].marks.map((m: { type: string }) => m.type),
    ).toEqual(['bold']);
    const copiedImage = copy.body.contentJson.content[1].attrs;
    expect(copiedImage.assetId).not.toBe(img.body.id);
    expect(copiedImage.src).toContain('X-Amz-Signature');
    expect((await fetch(copiedImage.src)).status).toBe(200);
    const assets = await http()
      .get(`/api/v1/documents/${copy.body.node.id}/assets`)
      .set(editor.auth)
      .expect(200);
    expect(assets.body.map((a: { id: string }) => a.id)).toEqual([copiedImage.assetId]);

    const again = await http()
      .post(`/api/v1/documents/${id}/copy`)
      .set(editor.auth)
      .send({})
      .expect(201);
    expect(again.body.node.name).toBe('Mẫu hợp đồng (bản sao) (1)');
    await http()
      .post(`/api/v1/documents/${id}/copy`)
      .set(editor.auth)
      .send({ name: 'mẫu hợp đồng (BẢN SAO)' })
      .expect(409);

    await http().post(`/api/v1/documents/${id}/copy`).set(viewer.auth).send({}).expect(404);
    await http().post(`/api/v1/documents/${id}/copy`).set(outsider.auth).send({}).expect(404);
    const own = await http()
      .post('/api/v1/workspaces')
      .set(viewer.auth)
      .send({ name: 'Của tôi', slug: 'cua-toi' })
      .expect(201);
    const mine = await http()
      .post(`/api/v1/documents/${id}/copy`)
      .set(viewer.auth)
      .send({ workspaceId: own.body.id })
      .expect(201);
    expect(mine.body.node).toMatchObject({
      workspaceId: own.body.id,
      parentId: null,
      name: 'Mẫu hợp đồng (bản sao)',
      myRole: 'OWNER',
    });
    await http()
      .post(`/api/v1/documents/${id}/copy`)
      .set(outsider.auth)
      .send({ workspaceId: own.body.id })
      .expect(404);

    const log = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'document.copy', targetId: mine.body.node.id },
    });
    expect(log.metadata).toMatchObject({ fromNodeId: id, fromWorkspaceId: wsId });
  });

  it('nhật ký chỉ ghi thêm: DB chặn sửa và xoá, trừ bản ghi quá 1 năm', async () => {
    const row = await ctx.prisma.auditLog.findFirstOrThrow();
    await expect(
      ctx.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'x' } }),
    ).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/,
    );
    const old = await ctx.prisma.auditLog.create({
      data: { action: 'test.old', createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    await ctx.prisma.auditLog.delete({ where: { id: old.id } });
  });

  it('gỡ thành viên báo collab server kiểm lại kết nối', async () => {
    const temp = await http()
      .post(`/api/v1/workspaces/${wsId}/members`)
      .set(owner.auth)
      .send({ email: 'temp@lunatech.vn' })
      .expect(201);
    const sub = new Redis(process.env.REDIS_URL!);
    const got = new Promise<string>((resolve) => sub.on('message', (_c, m) => resolve(m)));
    await sub.subscribe(COLLAB_ACCESS_CHANNEL);
    await http()
      .delete(`/api/v1/workspaces/${wsId}/members/${temp.body.user.id}`)
      .set(admin.auth)
      .expect(204);
    expect(JSON.parse(await got)).toEqual({ workspaceId: wsId, userId: temp.body.user.id });
    await sub.quit();
  });
});
