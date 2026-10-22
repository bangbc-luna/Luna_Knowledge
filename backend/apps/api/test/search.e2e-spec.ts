import {
  createSearchClient,
  loadSearchDocs,
  QUEUES,
  redisConnection,
  SEARCH_INDEX,
  SEARCH_JOBS,
  type SearchDoc,
  searchSettings,
} from '@luna/shared';
import { type Job, Queue, Worker } from 'bullmq';
import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Tìm kiếm (e2e)', () => {
  let ctx: TestContext;
  let admin: LoggedIn;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let guest: LoggedIn;
  let wsId: string;
  let otherWsId: string;
  let worker: Worker;
  let queue: Queue;
  const meili = createSearchClient(process.env.MEILI_URL!, process.env.MEILI_MASTER_KEY!);
  const http = () => request(ctx.app.getHttpServer());

  const index = async (ids: string[]) => {
    const docs = await loadSearchDocs(ctx.prisma, ids);
    const found = new Set(docs.map((d) => d.id));
    const gone = ids.filter((id) => !found.has(id));
    if (docs.length) await meili.index<SearchDoc>(SEARCH_INDEX).addDocuments(docs).waitTask();
    if (gone.length) await meili.index(SEARCH_INDEX).deleteDocuments(gone).waitTask();
  };

  const settle = async () => {
    for (let i = 0; i < 100; i++) {
      const c = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      if (!c.waiting && !c.active && !c.delayed && !c.prioritized) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('search queue did not settle');
  };

  const search = (as: LoggedIn, q: string, extra: Record<string, string> = {}) =>
    http()
      .get('/api/v1/search')
      .query({ q, ...extra })
      .set(as.auth);
  const names = (res: request.Response) =>
    res.body.items.map((i: { node: { name: string } }) => i.node.name).sort();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    await meili.deleteIndexIfExists(SEARCH_INDEX);
    await meili.createIndex(SEARCH_INDEX, { primaryKey: 'id' }).waitTask();
    await meili.index(SEARCH_INDEX).updateSettings(searchSettings).waitTask();
    const connection = redisConnection(process.env.REDIS_URL!);
    queue = new Queue(QUEUES.SEARCH_INDEX, { connection, prefix: 'luna' });
    await queue.obliterate({ force: true });
    worker = new Worker(
      QUEUES.SEARCH_INDEX,
      async (job: Job) => {
        if (job.name === SEARCH_JOBS.INDEX_NODE) return index([job.data.nodeId]);
        if (job.name === SEARCH_JOBS.INDEX_TREE) {
          const rows = await ctx.prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM nodes WHERE path <@ (SELECT path FROM nodes WHERE id = ${job.data.nodeId}::uuid)`;
          return index(rows.length ? rows.map((r) => r.id) : [job.data.nodeId]);
        }
        if (job.name === SEARCH_JOBS.REINDEX_ALL) {
          const rows = await ctx.prisma.node.findMany({ select: { id: true } });
          return index(rows.map((r) => r.id));
        }
      },
      { connection, prefix: 'luna' },
    );

    admin = await loginAsAdmin(ctx);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    guest = await loginAs(ctx, 'guest@lunatech.vn', { name: 'Guest' });
    wsId = (
      await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({ name: 'Tài chính', slug: 'tai-chinh', memberEmails: ['bob@lunatech.vn'] })
        .expect(201)
    ).body.id;
    otherWsId = (
      await http()
        .post('/api/v1/workspaces')
        .set(admin.auth)
        .send({ name: 'Kỹ thuật', slug: 'ky-thuat', memberEmails: ['admin@lunatech.vn'] })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await ctx?.close();
  });

  let folderId: string;
  let docId: string;

  it('tìm không dấu ra tên có dấu, tô đúng chỗ khớp; nội dung tài liệu có đoạn trích', async () => {
    folderId = (
      await http()
        .post(`/api/v1/workspaces/${wsId}/folders`)
        .set(alice.auth)
        .send({ name: 'Báo cáo tài chính' })
        .expect(201)
    ).body.id;
    docId = (
      await http()
        .post(`/api/v1/workspaces/${wsId}/documents`)
        .set(alice.auth)
        .send({ name: 'Kế hoạch quý 4', parentId: folderId })
        .expect(201)
    ).body.node.id;
    await ctx.prisma.document.update({
      where: { nodeId: docId },
      data: {
        contentText: `${'Mở đầu tài liệu. '.repeat(20)}Quy trình đề xuất ngân sách cho phòng ban. Kết thúc.`,
      },
    });
    await queue.add(SEARCH_JOBS.INDEX_NODE, { nodeId: docId });
    await settle();

    const byName = await search(bob, 'bao cao').expect(200);
    expect(byName.body.items).toHaveLength(1);
    expect(byName.body.items[0]).toMatchObject({
      matchedIn: 'name',
      workspace: { id: wsId, name: 'Tài chính' },
      path: [],
      name: [
        { text: 'Báo cáo', match: true },
        { text: ' tài chính', match: false },
      ],
    });

    const byContent = await search(bob, 'đề xuất').expect(200);
    const hit = byContent.body.items[0];
    expect(hit).toMatchObject({ matchedIn: 'content', path: ['Báo cáo tài chính'] });
    expect(hit.node).toMatchObject({ id: docId, type: 'DOCUMENT', myRole: 'EDITOR' });
    expect(hit.snippet[0].text).toBe('…');
    expect(
      hit.snippet.filter((p: { match: boolean }) => p.match).map((p: { text: string }) => p.text),
    ).toEqual(['đề xuất']);
  });

  it('người ngoài không thấy; được share thì thấy cả nhánh; thu hồi share thì mất', async () => {
    expect((await search(guest, 'ke hoach').expect(200)).body.items).toEqual([]);
    const share = await http()
      .post(`/api/v1/nodes/${folderId}/shares`)
      .set(alice.auth)
      .send({ email: 'guest@lunatech.vn', role: 'VIEWER' })
      .expect(201);
    await settle();
    const seen = await search(guest, 'ke hoach').expect(200);
    expect(names(seen)).toEqual(['Kế hoạch quý 4']);
    expect(seen.body.items[0].node.myRole).toBe('VIEWER');
    expect(seen.body.items[0].path).toEqual([]);

    await http()
      .delete(`/api/v1/nodes/${folderId}/shares/${share.body.id}`)
      .set(alice.auth)
      .expect(204);
    await settle();
    expect((await search(guest, 'ke hoach').expect(200)).body.items).toEqual([]);
  });

  it('bộ lọc: loại, khu, workspace, tag, người tạo', async () => {
    const tag = await http()
      .post(`/api/v1/workspaces/${wsId}/tags`)
      .set(bob.auth)
      .send({ name: 'Quan trọng', color: '#e5534b' })
      .expect(201);
    await http()
      .put(`/api/v1/nodes/${docId}/tags`)
      .set(bob.auth)
      .send({ tagIds: [tag.body.id] })
      .expect(200);
    await http()
      .post(`/api/v1/workspaces/${wsId}/folders`)
      .set(bob.auth)
      .send({ name: 'Báo cáo video', section: 'VIDEOS' })
      .expect(201);
    await settle();

    expect(names(await search(bob, 'bao cao').expect(200))).toEqual([
      'Báo cáo tài chính',
      'Báo cáo video',
    ]);
    expect(names(await search(bob, 'bao cao', { section: 'VIDEOS' }).expect(200))).toEqual([
      'Báo cáo video',
    ]);
    expect(names(await search(bob, 'bao cao', { createdBy: alice.userId }).expect(200))).toEqual([
      'Báo cáo tài chính',
    ]);
    expect(names(await search(bob, 'quy', { type: 'DOCUMENT' }).expect(200))).toEqual([
      'Kế hoạch quý 4',
    ]);
    expect(names(await search(bob, 'quan trong').expect(200))).toEqual(['Kế hoạch quý 4']);
    expect((await search(bob, 'quan trong').expect(200)).body.items[0].matchedIn).toBe('tags');
    expect(names(await search(bob, 'ke hoach', { tagIds: tag.body.id }).expect(200))).toEqual([
      'Kế hoạch quý 4',
    ]);
    expect(
      (await search(bob, 'bao cao', { workspaceId: otherWsId }).expect(200)).body.items,
    ).toEqual([]);
    await search(bob, '   ').expect(400);
    await search(bob, 'x', { tagIds: 'not-a-uuid' }).expect(400);
  });

  it('xoá vào thùng rác thì mất khỏi kết quả, khôi phục thì có lại', async () => {
    await http().delete(`/api/v1/nodes/${folderId}`).set(alice.auth).expect(204);
    await settle();
    expect(names(await search(bob, 'tai chinh').expect(200))).toEqual([]);
    expect(names(await search(bob, 'ke hoach').expect(200))).toEqual([]);
    await http().post(`/api/v1/nodes/${folderId}/restore`).set(alice.auth).expect(200);
    await settle();
    expect(names(await search(bob, 'ke hoach').expect(200))).toEqual(['Kế hoạch quý 4']);
  });

  it('chữ trích từ file được tìm; admin dựng lại chỉ mục, thành viên không được', async () => {
    const file = await ctx.prisma.node.create({
      data: {
        workspaceId: wsId,
        type: 'FILE',
        name: 'hop-dong.pdf',
        nameNormalized: 'hop-dong.pdf',
        createdById: bob.userId,
        file: { create: { extractedText: 'Điều khoản thanh toán trong vòng ba mươi ngày' } },
      },
    });
    await http().post('/api/v1/admin/search/reindex').set(bob.auth).expect(403);
    await http().post('/api/v1/admin/search/reindex').set(admin.auth).expect(202);
    await settle();
    const res = await search(alice, 'dieu khoan thanh toan').expect(200);
    expect(res.body.items.map((i: { node: { id: string } }) => i.node.id)).toEqual([file.id]);
  });

  it('chỉ mục lỗi thời vẫn bị hậu kiểm quyền', async () => {
    await meili
      .index<SearchDoc>(SEARCH_INDEX)
      .updateDocuments([{ id: docId, acl: [`user:${guest.userId}`] } as SearchDoc])
      .waitTask();
    expect((await search(guest, 'ke hoach').expect(200)).body.items).toEqual([]);
  });

  it('phân trang bằng cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await http()
        .post(`/api/v1/workspaces/${wsId}/folders`)
        .set(bob.auth)
        .send({ name: `Hồ sơ ${i}` })
        .expect(201);
    }
    await settle();
    const p1 = await search(bob, 'ho so', { limit: '2' }).expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBe('2');
    const p2 = await search(bob, 'ho so', { limit: '2', cursor: p1.body.nextCursor }).expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
  });
});
