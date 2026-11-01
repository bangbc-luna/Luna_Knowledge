import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Node type guards (e2e)', () => {
  let ctx: TestContext;
  let owner: LoggedIn;
  let editor: LoggedIn;
  let viewer: LoggedIn;
  let wsId: string;
  let folderId: string;
  let docId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await loginAs(ctx, 'owner@lunatech.vn');
    editor = await loginAs(ctx, 'editor@lunatech.vn');
    viewer = await loginAs(ctx, 'viewer@lunatech.vn');
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(owner.auth)
      .send({ name: 'Types', slug: 'types', memberEmails: ['editor@lunatech.vn'] })
      .expect(201);
    wsId = ws.body.id;
    folderId = (
      await http()
        .post(`/api/v1/workspaces/${wsId}/folders`)
        .set(owner.auth)
        .send({ name: 'Thư mục', section: 'DOCS' })
        .expect(201)
    ).body.id;
    const doc = await ctx.prisma.node.create({
      data: {
        workspaceId: wsId,
        type: 'DOCUMENT',
        section: 'DOCS',
        name: 'Tài liệu',
        nameNormalized: 'tài liệu',
        createdById: owner.userId,
      },
    });
    docId = doc.id;
    await http()
      .post(`/api/v1/nodes/${docId}/shares`)
      .set(owner.auth)
      .send({ email: 'viewer@lunatech.vn', role: 'VIEWER' })
      .expect(201);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it.each([
    ['get', '/api/v1/documents/:folder', 'Document not found'],
    ['get', '/api/v1/videos/:doc', 'Video not found'],
    ['get', '/api/v1/files/:folder', 'File not found'],
    ['post', '/api/v1/files/:doc/convert-to-document', 'File not found'],
  ])('%s %s on the wrong node type returns 404', async (method, path, message) => {
    const url = path.replace(':folder', folderId).replace(':doc', docId);
    const res = await (http() as unknown as Record<string, (u: string) => request.Test>)[method]!(
      url,
    ).set(editor.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(message);
  });

  it('PATCH /api/v1/videos/:doc on the wrong node type returns 404 Item not found', async () => {
    const res = await http()
      .patch(`/api/v1/videos/${docId}`)
      .set(editor.auth)
      .send({ title: 'Mới', description: 'Mô tả' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Item not found');
  });

  it('a viewer on a wrong-type item gets 403 before 404', async () => {
    const res = await http()
      .patch(`/api/v1/videos/${docId}`)
      .set(viewer.auth)
      .send({ title: 'Mới', description: 'Mô tả' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('You only have view access to this item');
  });
});
