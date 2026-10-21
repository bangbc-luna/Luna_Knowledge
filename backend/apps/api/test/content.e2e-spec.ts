import { purgeExpiredTrash } from '@luna/db';
import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Content tree, sharing, trash (e2e)', () => {
  let ctx: TestContext;
  let sysadmin: LoggedIn;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let viewer: LoggedIn;
  let guest: LoggedIn;
  let wsId: string;
  let otherWsId: string;
  const http = () => request(ctx.app.getHttpServer());

  const createFolder = (
    as: LoggedIn,
    name: string,
    parentId: string | null = null,
    ws = wsId,
    section?: 'DOCS' | 'VIDEOS',
  ) =>
    http().post(`/api/v1/workspaces/${ws}/folders`).set(as.auth).send({ name, parentId, section });

  const list = (as: LoggedIn, parentId?: string, query = '') =>
    http()
      .get(`/api/v1/workspaces/${wsId}/nodes?${parentId ? `parentId=${parentId}&` : ''}${query}`)
      .set(as.auth);

  const share = (as: LoggedIn, nodeId: string, email: string, role: 'EDITOR' | 'VIEWER') =>
    http().post(`/api/v1/nodes/${nodeId}/shares`).set(as.auth).send({ email, role });

  const roleOf = async (as: LoggedIn, nodeId: string) =>
    (await http().get(`/api/v1/nodes/${nodeId}`).set(as.auth).expect(200)).body.myRole;

  const names = (res: request.Response) => res.body.items.map((n: { name: string }) => n.name);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    sysadmin = await loginAsAdmin(ctx);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    viewer = await loginAs(ctx, 'viewer@lunatech.vn');
    guest = await loginAs(ctx, 'guest@lunatech.vn');

    const ws = await http()
      .post('/api/v1/workspaces')
      .set(sysadmin.auth)
      .send({ name: 'Docs', slug: 'docs', memberEmails: ['alice@lunatech.vn', 'bob@lunatech.vn'] })
      .expect(201);
    wsId = ws.body.id;
    const other = await http()
      .post('/api/v1/workspaces')
      .set(sysadmin.auth)
      .send({ name: 'Other', slug: 'other', memberEmails: ['alice@lunatech.vn'] })
      .expect(201);
    otherWsId = other.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('folders', () => {
    it('thành viên tạo folder ở gốc và lồng nhau; người tạo là OWNER, thành viên khác là EDITOR; người ngoài 404', async () => {
      const root = await createFolder(alice, 'Dự án').expect(201);
      expect(root.body).toMatchObject({
        type: 'FOLDER',
        name: 'Dự án',
        section: 'DOCS',
        myRole: 'OWNER',
        childCount: 0,
      });
      expect(await roleOf(bob, root.body.id)).toBe('EDITOR');
      const sub = await createFolder(bob, 'Thiết kế', root.body.id).expect(201);
      expect(sub.body.myRole).toBe('OWNER');
      expect(await roleOf(alice, sub.body.id)).toBe('OWNER');
      await createFolder(guest, 'Không được').expect(404);
      await list(sysadmin).expect(404);
      await createFolder(sysadmin, 'Không được').expect(404);
    });

    it('người được share chỉ xem không tạo được mục bên trong (403)', async () => {
      const f = (await createFolder(alice, 'Chỉ xem').expect(201)).body.id;
      await share(alice, f, 'viewer@lunatech.vn', 'VIEWER').expect(201);
      expect(await roleOf(viewer, f)).toBe('VIEWER');
      await createFolder(viewer, 'Không được', f).expect(403);
      await createFolder(viewer, 'Không được').expect(404);
    });

    it('trùng tên (không phân biệt hoa thường, NFC) → 409 kèm gợi ý', async () => {
      const decomposed = 'Dự án';
      expect(decomposed.normalize('NFC')).toBe('Dự án');
      const res = await createFolder(bob, `  ${decomposed.toUpperCase()} `).expect(409);
      expect(res.body.error.details.suggestion).toBe('DỰ ÁN (1)');
    });

    it('tên không hợp lệ → 400', async () => {
      await createFolder(alice, 'a/b').expect(400);
      await createFolder(alice, '   ').expect(400);
    });

    it('liệt kê: folder trước, sắp xếp, phân trang', async () => {
      const parent = (await createFolder(alice, 'Sắp xếp').expect(201)).body.id;
      for (const n of ['b', 'C', 'a']) await createFolder(alice, n, parent).expect(201);
      await ctx.prisma.node.create({
        data: {
          workspaceId: wsId,
          parentId: parent,
          type: 'DOCUMENT',
          name: 'aaa doc',
          nameNormalized: 'aaa doc',
          createdById: alice.userId,
        },
      });
      const all = await list(bob, parent).expect(200);
      expect(names(all)).toEqual(['a', 'b', 'C', 'aaa doc']);
      expect(all.body.items[0].myRole).toBe('EDITOR');

      const desc = await list(bob, parent, 'order=desc').expect(200);
      expect(names(desc)).toEqual(['C', 'b', 'a', 'aaa doc']);

      const p1 = await list(bob, parent, 'limit=2').expect(200);
      expect(names(p1)).toEqual(['a', 'b']);
      const p2 = await list(bob, parent, `limit=2&cursor=${p1.body.nextCursor}`).expect(200);
      expect(names(p2)).toEqual(['C', 'aaa doc']);
      expect(p2.body.nextCursor).toBeNull();

      const onlyDocs = await list(bob, parent, 'type=DOCUMENT').expect(200);
      expect(names(onlyDocs)).toEqual(['aaa doc']);

      await share(alice, parent, 'viewer@lunatech.vn', 'VIEWER').expect(201);
      const shared = await list(viewer, parent).expect(200);
      expect(names(shared)).toEqual(['a', 'b', 'C', 'aaa doc']);
      expect(shared.body.items[0].myRole).toBe('VIEWER');
    });

    it('đổi tên (thành viên không phải người tạo cũng đổi được); trùng tên khi đổi → 409; chỉ xem → 403', async () => {
      const a = (await createFolder(alice, 'Tên A').expect(201)).body.id;
      await createFolder(alice, 'Tên B').expect(201);
      const res = await http()
        .patch(`/api/v1/nodes/${a}`)
        .set(bob.auth)
        .send({ name: 'Tên A mới' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Tên A mới', myRole: 'EDITOR' });
      await http().patch(`/api/v1/nodes/${a}`).set(bob.auth).send({ name: 'tên b' }).expect(409);
      await http()
        .patch(`/api/v1/nodes/${a}`)
        .set(alice.auth)
        .send({ name: 'TÊN A MỚI' })
        .expect(200);
      await share(alice, a, 'viewer@lunatech.vn', 'VIEWER').expect(201);
      await http().patch(`/api/v1/nodes/${a}`).set(viewer.auth).send({ name: 'x' }).expect(403);
    });
  });

  describe('sections', () => {
    it('folder gốc cùng tên được ở cả DOCS và VIDEOS; liệt kê gốc theo section (mặc định DOCS)', async () => {
      const docs = (await createFolder(alice, 'Đào tạo').expect(201)).body;
      expect(docs.section).toBe('DOCS');
      const videos = (await createFolder(alice, 'Đào tạo', null, wsId, 'VIDEOS').expect(201)).body;
      expect(videos.section).toBe('VIDEOS');
      await createFolder(alice, 'đào tạo', null, wsId, 'VIDEOS').expect(409);

      const docsRoot = await list(bob).expect(200);
      expect(docsRoot.body.items.map((n: { id: string }) => n.id)).toContain(docs.id);
      expect(docsRoot.body.items.map((n: { id: string }) => n.id)).not.toContain(videos.id);
      const videosRoot = await list(bob, undefined, 'section=VIDEOS').expect(200);
      expect(videosRoot.body.items.map((n: { id: string }) => n.id)).toEqual([videos.id]);
      await list(bob, undefined, 'section=OTHER').expect(400);
    });

    it('folder con theo section của folder cha', async () => {
      const videos = (await createFolder(alice, 'Video nội bộ', null, wsId, 'VIDEOS').expect(201))
        .body.id;
      const child = await createFolder(bob, 'Quý 1', videos).expect(201);
      expect(child.body.section).toBe('VIDEOS');
    });

    it('không di chuyển sang folder của section khác; chuyển về gốc giữ nguyên section', async () => {
      const docsFolder = (await createFolder(alice, 'Khu tài liệu').expect(201)).body.id;
      const videosFolder = (
        await createFolder(alice, 'Khu video', null, wsId, 'VIDEOS').expect(201)
      ).body.id;
      const videoChild = (await createFolder(alice, 'Clip', videosFolder).expect(201)).body.id;

      await http()
        .post(`/api/v1/nodes/${docsFolder}/move`)
        .set(alice.auth)
        .send({ targetParentId: videosFolder })
        .expect(400);
      await http()
        .post(`/api/v1/nodes/${videoChild}/move`)
        .set(alice.auth)
        .send({ targetParentId: docsFolder })
        .expect(400);

      const moved = await http()
        .post(`/api/v1/nodes/${videoChild}/move`)
        .set(alice.auth)
        .send({ targetParentId: null })
        .expect(200);
      expect(moved.body).toMatchObject({ parentId: null, section: 'VIDEOS' });
      const videosRoot = await list(alice, undefined, 'section=VIDEOS').expect(200);
      expect(names(videosRoot)).toContain('Clip');
      expect(names(await list(alice).expect(200))).not.toContain('Clip');
    });
  });

  describe('move & breadcrumb', () => {
    let a: string;
    let b: string;
    let c: string;
    let target: string;

    beforeAll(async () => {
      a = (await createFolder(alice, 'Move A').expect(201)).body.id;
      b = (await createFolder(alice, 'Move B', a).expect(201)).body.id;
      c = (await createFolder(alice, 'Move C', b).expect(201)).body.id;
      target = (await createFolder(alice, 'Move Target').expect(201)).body.id;
    });

    const crumb = async (id: string, as = alice) =>
      (await http().get(`/api/v1/nodes/${id}/breadcrumb`).set(as.auth).expect(200)).body.map(
        (x: { name: string }) => x.name,
      );

    it('breadcrumb đầy đủ cho thành viên', async () => {
      expect(await crumb(c, bob)).toEqual(['Move A', 'Move B', 'Move C']);
    });

    it('di chuyển cả nhánh (thành viên khác cũng di chuyển được): path của cây con được cập nhật', async () => {
      await http()
        .post(`/api/v1/nodes/${b}/move`)
        .set(bob.auth)
        .send({ targetParentId: target })
        .expect(200);
      expect(await crumb(c)).toEqual(['Move Target', 'Move B', 'Move C']);
      const children = await list(alice, a).expect(200);
      expect(children.body.items).toEqual([]);
      await http()
        .post(`/api/v1/nodes/${c}/move`)
        .set(alice.auth)
        .send({ targetParentId: null })
        .expect(200);
      expect(await crumb(c)).toEqual(['Move C']);
    });

    it('không di chuyển folder vào chính nó hoặc cây con của nó', async () => {
      await http()
        .post(`/api/v1/nodes/${target}/move`)
        .set(alice.auth)
        .send({ targetParentId: target })
        .expect(400);
      const res = await http()
        .post(`/api/v1/nodes/${target}/move`)
        .set(alice.auth)
        .send({ targetParentId: b })
        .expect(400);
      expect(res.body.error.message).toMatch(/own subfolder/);
    });

    it('không di chuyển sang workspace khác; người chỉ xem không di chuyển được', async () => {
      const foreign = (await createFolder(alice, 'Foreign', null, otherWsId).expect(201)).body.id;
      await http()
        .post(`/api/v1/nodes/${b}/move`)
        .set(alice.auth)
        .send({ targetParentId: foreign })
        .expect(400);
      await share(alice, target, 'viewer@lunatech.vn', 'VIEWER').expect(201);
      await share(alice, a, 'viewer@lunatech.vn', 'VIEWER').expect(201);
      await http()
        .post(`/api/v1/nodes/${b}/move`)
        .set(viewer.auth)
        .send({ targetParentId: a })
        .expect(403);
    });

    it('trùng tên ở folder đích → 409', async () => {
      await createFolder(alice, 'Move B', a).expect(201);
      await http()
        .post(`/api/v1/nodes/${b}/move`)
        .set(alice.auth)
        .send({ targetParentId: a })
        .expect(409);
    });
  });

  describe('sharing', () => {
    let shared: string;
    let sub: string;
    let shareId: string;

    beforeAll(async () => {
      const parent = (await createFolder(alice, 'Phòng ban').expect(201)).body.id;
      shared = (await createFolder(alice, 'Chia sẻ', parent).expect(201)).body.id;
      sub = (await createFolder(alice, 'Con', shared).expect(201)).body.id;
    });

    it('chỉ OWNER quản lý share; thành viên thường 403', async () => {
      await share(bob, shared, 'guest@lunatech.vn', 'VIEWER').expect(403);
      await http().get(`/api/v1/nodes/${shared}/shares`).set(bob.auth).expect(403);
      const res = await share(alice, shared, 'guest@lunatech.vn', 'VIEWER').expect(201);
      expect(res.body).toMatchObject({ role: 'VIEWER', user: { email: 'guest@lunatech.vn' } });
      shareId = res.body.id;
      await share(alice, shared, 'guest@lunatech.vn', 'EDITOR').expect(409);
      await http()
        .patch(`/api/v1/nodes/${shared}/shares/${shareId}`)
        .set(bob.auth)
        .send({ role: 'EDITOR' })
        .expect(403);
      await http().delete(`/api/v1/nodes/${shared}/shares/${shareId}`).set(bob.auth).expect(403);
    });

    it('người được share (ngoài workspace) xem được folder và cả cây con, không xem được gốc', async () => {
      const children = await list(guest, shared).expect(200);
      expect(names(children)).toEqual(['Con']);
      expect(children.body.items[0].myRole).toBe('VIEWER');
      await http().get(`/api/v1/nodes/${sub}`).set(guest.auth).expect(200);
      await list(guest).expect(404);
      await http().get(`/api/v1/workspaces/${wsId}`).set(guest.auth).expect(404);
      await createFolder(guest, 'x', shared).expect(403);
      await http().delete(`/api/v1/nodes/${sub}`).set(guest.auth).expect(403);
    });

    it('breadcrumb của người được share bắt đầu từ folder được share', async () => {
      const res = await http().get(`/api/v1/nodes/${sub}/breadcrumb`).set(guest.auth).expect(200);
      expect(res.body.map((x: { name: string }) => x.name)).toEqual(['Chia sẻ', 'Con']);
    });

    it('shared-with-me liệt kê mục được share kèm workspace', async () => {
      const res = await http().get('/api/v1/shared-with-me').set(guest.auth).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        shareRole: 'VIEWER',
        node: { id: shared, name: 'Chia sẻ' },
        workspace: { id: wsId, slug: 'docs' },
        sharedBy: { email: 'alice@lunatech.vn' },
      });
    });

    it('nâng share lên EDITOR → thành OWNER: tạo mục bên trong, quản lý share, nhưng không tạo ở gốc', async () => {
      await http()
        .patch(`/api/v1/nodes/${shared}/shares/${shareId}`)
        .set(alice.auth)
        .send({ role: 'EDITOR' })
        .expect(200);
      expect(await roleOf(guest, sub)).toBe('OWNER');
      await createFolder(guest, 'Của khách', sub).expect(201);
      await createFolder(guest, 'Của khách').expect(404);
      await http().get(`/api/v1/nodes/${shared}/shares`).set(guest.auth).expect(200);
    });

    it('share EDITOR cho thành viên → thành viên thành OWNER (xoá, chia sẻ được)', async () => {
      expect(await roleOf(bob, sub)).toBe('EDITOR');
      await http().get(`/api/v1/nodes/${sub}/shares`).set(bob.auth).expect(403);
      await share(alice, shared, 'bob@lunatech.vn', 'EDITOR').expect(201);
      expect(await roleOf(bob, sub)).toBe('OWNER');
      await http().get(`/api/v1/nodes/${sub}/shares`).set(bob.auth).expect(200);
    });

    it('danh sách share hiển thị share kế thừa ở folder con', async () => {
      const res = await http().get(`/api/v1/nodes/${sub}/shares`).set(alice.auth).expect(200);
      expect(res.body.direct).toEqual([]);
      expect(
        res.body.inherited.map((s: { user: { email: string } }) => s.user.email).sort(),
      ).toEqual(['bob@lunatech.vn', 'guest@lunatech.vn']);
      expect(res.body.inherited[0].fromNode).toEqual({ id: shared, name: 'Chia sẻ' });
    });

    it('thu hồi share → mất quyền ngay', async () => {
      await http().delete(`/api/v1/nodes/${shared}/shares/${shareId}`).set(alice.auth).expect(204);
      await http().get(`/api/v1/nodes/${sub}`).set(guest.auth).expect(404);
      const res = await http().get('/api/v1/shared-with-me').set(guest.auth).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('activity', () => {
    it('OWNER xem lịch sử hoạt động của mục; thành viên thường 403', async () => {
      const f = (await createFolder(alice, 'Có lịch sử').expect(201)).body.id;
      await http()
        .patch(`/api/v1/nodes/${f}`)
        .set(bob.auth)
        .send({ name: 'Có lịch sử 2' })
        .expect(200);
      await share(alice, f, 'guest@lunatech.vn', 'VIEWER').expect(201);

      await http().get(`/api/v1/nodes/${f}/activity`).set(bob.auth).expect(403);
      await http().get(`/api/v1/nodes/${f}/activity`).set(guest.auth).expect(403);
      await http().get(`/api/v1/nodes/${f}/activity`).set(viewer.auth).expect(404);

      const res = await http().get(`/api/v1/nodes/${f}/activity`).set(alice.auth).expect(200);
      expect(res.body.items.map((i: { action: string }) => i.action)).toEqual([
        'share.add',
        'node.rename',
        'node.create',
      ]);
      expect(res.body.items[1]).toMatchObject({
        id: expect.any(String),
        actor: { email: 'bob@lunatech.vn' },
        metadata: { from: 'Có lịch sử', to: 'Có lịch sử 2' },
        createdAt: expect.any(String),
      });
      expect(res.body.items[2].actor.email).toBe('alice@lunatech.vn');
      expect(res.body.nextCursor).toBeNull();

      const p1 = await http()
        .get(`/api/v1/nodes/${f}/activity?limit=2`)
        .set(alice.auth)
        .expect(200);
      expect(p1.body.items).toHaveLength(2);
      const p2 = await http()
        .get(`/api/v1/nodes/${f}/activity?limit=2&cursor=${p1.body.nextCursor}`)
        .set(alice.auth)
        .expect(200);
      expect(p2.body.items.map((i: { action: string }) => i.action)).toEqual(['node.create']);
      expect(p2.body.nextCursor).toBeNull();
    });
  });

  describe('trash', () => {
    let root: string;
    let child: string;

    beforeAll(async () => {
      root = (await createFolder(alice, 'Rác').expect(201)).body.id;
      child = (await createFolder(alice, 'Rác con', root).expect(201)).body.id;
      await createFolder(alice, 'Rác cháu', child).expect(201);
    });

    it('chỉ OWNER xoá: thành viên thường 403; người tạo folder cha xoá được mục con người khác tạo', async () => {
      const p = (await createFolder(alice, 'Của Alice').expect(201)).body.id;
      const q = (await createFolder(bob, 'Của Bob', p).expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${p}`).set(bob.auth).expect(403);
      expect(await roleOf(alice, q)).toBe('OWNER');
      await http().delete(`/api/v1/nodes/${q}`).set(alice.auth).expect(204);
      await http().delete(`/api/v1/nodes/${p}`).set(alice.auth).expect(204);
      const own = (await createFolder(bob, 'Bob tự xoá').expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${own}`).set(bob.auth).expect(204);
    });

    it('xóa cả nhánh vào thùng rác; mục con không còn truy cập', async () => {
      await http().delete(`/api/v1/nodes/${root}`).set(alice.auth).expect(204);
      await http().get(`/api/v1/nodes/${child}`).set(alice.auth).expect(404);
      const trash = await http().get(`/api/v1/workspaces/${wsId}/trash`).set(bob.auth).expect(200);
      const item = trash.body.find((t: { id: string }) => t.id === root);
      expect(item).toMatchObject({
        name: 'Rác',
        itemCount: 3,
        deletedBy: { email: 'alice@lunatech.vn' },
      });
      await http().get(`/api/v1/workspaces/${wsId}/trash`).set(sysadmin.auth).expect(200);
      await http().get(`/api/v1/workspaces/${wsId}/trash`).set(viewer.auth).expect(404);
    });

    it('chỉ khôi phục được mục gốc của lần xóa', async () => {
      const res = await http().post(`/api/v1/nodes/${child}/restore`).set(alice.auth).expect(400);
      expect(res.body.error.message).toMatch(/parent folder/);
    });

    it('khôi phục cả nhánh về chỗ cũ; trùng tên thì tự đổi tên', async () => {
      await createFolder(alice, 'Rác').expect(201);
      const res = await http().post(`/api/v1/nodes/${root}/restore`).set(alice.auth).expect(200);
      expect(res.body).toMatchObject({
        movedToRoot: false,
        renamed: true,
        node: { name: 'Rác (1)', childCount: 1 },
      });
      await http().get(`/api/v1/nodes/${child}`).set(alice.auth).expect(200);
    });

    it('folder cha đã bị xóa → khôi phục về gốc workspace', async () => {
      await http().delete(`/api/v1/nodes/${child}`).set(alice.auth).expect(204);
      await http().delete(`/api/v1/nodes/${root}`).set(alice.auth).expect(204);
      const res = await http().post(`/api/v1/nodes/${child}/restore`).set(alice.auth).expect(200);
      expect(res.body).toMatchObject({ movedToRoot: true, node: { parentId: null } });
      const crumb = await http()
        .get(`/api/v1/nodes/${child}/breadcrumb`)
        .set(alice.auth)
        .expect(200);
      expect(crumb.body.map((x: { name: string }) => x.name)).toEqual(['Rác con']);
    });

    it('chỉ người xoá hoặc System Admin khôi phục được', async () => {
      const f = (await createFolder(alice, 'Alice xóa').expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${f}`).set(alice.auth).expect(204);
      await http().post(`/api/v1/nodes/${f}/restore`).set(bob.auth).expect(403);
      await http().post(`/api/v1/nodes/${f}/restore`).set(viewer.auth).expect(404);
      const res = await http().post(`/api/v1/nodes/${f}/restore`).set(sysadmin.auth).expect(200);
      expect(res.body).toMatchObject({
        node: null,
        name: 'Alice xóa',
        movedToRoot: false,
        renamed: false,
      });
      const node = await ctx.prisma.node.findUniqueOrThrow({ where: { id: f } });
      expect(node.deletedAt).toBeNull();
    });

    it('xóa vĩnh viễn chỉ System Admin (kể cả không là thành viên); xóa cả nhánh khỏi DB', async () => {
      await http().delete(`/api/v1/nodes/${root}/permanent`).set(alice.auth).expect(403);
      await http().delete(`/api/v1/nodes/${root}/permanent`).set(bob.auth).expect(403);
      await http().delete(`/api/v1/nodes/${root}/permanent`).set(viewer.auth).expect(404);
      await http().delete(`/api/v1/nodes/${root}/permanent`).set(sysadmin.auth).expect(204);
      expect(await ctx.prisma.node.count({ where: { id: root } })).toBe(0);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'node.delete_permanent', targetId: root },
        }),
      ).toBe(1);
    });

    it('dọn sạch thùng rác chỉ System Admin', async () => {
      const f = (await createFolder(alice, 'Dọn').expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${f}`).set(alice.auth).expect(204);
      await http().delete(`/api/v1/workspaces/${wsId}/trash`).set(alice.auth).expect(403);
      const res = await http()
        .delete(`/api/v1/workspaces/${wsId}/trash`)
        .set(sysadmin.auth)
        .expect(200);
      expect(res.body.deleted).toBeGreaterThanOrEqual(1);
      const trash = await http()
        .get(`/api/v1/workspaces/${wsId}/trash`)
        .set(alice.auth)
        .expect(200);
      expect(trash.body).toEqual([]);
    });

    it('job dọn thùng rác chỉ xóa mục quá 30 ngày', async () => {
      const oldF = (await createFolder(alice, 'Cũ').expect(201)).body.id;
      const newF = (await createFolder(alice, 'Mới').expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${oldF}`).set(alice.auth).expect(204);
      await http().delete(`/api/v1/nodes/${newF}`).set(alice.auth).expect(204);
      await ctx.prisma.node.update({
        where: { id: oldF },
        data: { deletedAt: new Date(Date.now() - 31 * 24 * 3600_000) },
      });
      expect(await purgeExpiredTrash(ctx.prisma)).toBe(1);
      expect(await ctx.prisma.node.count({ where: { id: { in: [oldF, newF] } } })).toBe(1);
    });
  });

  describe('tags, favorites, recent', () => {
    let folder: string;
    let tagId: string;

    beforeAll(async () => {
      folder = (await createFolder(alice, 'Có tag').expect(201)).body.id;
    });

    it('thành viên tạo tag, trùng tên 409; người ngoài workspace không tạo được', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${wsId}/tags`)
        .set(bob.auth)
        .send({ name: 'Quan trọng', color: '#FF0000' })
        .expect(201);
      expect(res.body.color).toBe('#ff0000');
      tagId = res.body.id;
      await http()
        .post(`/api/v1/workspaces/${wsId}/tags`)
        .set(alice.auth)
        .send({ name: 'Quan trọng', color: '#00ff00' })
        .expect(409);
      await http()
        .post(`/api/v1/workspaces/${wsId}/tags`)
        .set(viewer.auth)
        .send({ name: 'x', color: '#00ff00' })
        .expect(404);
      await http()
        .post(`/api/v1/workspaces/${wsId}/tags`)
        .set(bob.auth)
        .send({ name: 'y', color: 'red' })
        .expect(400);
      const tags = await http().get(`/api/v1/workspaces/${wsId}/tags`).set(alice.auth).expect(200);
      expect(tags.body.map((t: { name: string }) => t.name)).toEqual(['Quan trọng']);
    });

    it('gán tag cho mục; tag của workspace khác → 400; người chỉ xem → 403', async () => {
      const res = await http()
        .put(`/api/v1/nodes/${folder}/tags`)
        .set(bob.auth)
        .send({ tagIds: [tagId] })
        .expect(200);
      expect(res.body.tags).toEqual([{ id: tagId, name: 'Quan trọng', color: '#ff0000' }]);
      const foreign = await http()
        .post(`/api/v1/workspaces/${otherWsId}/tags`)
        .set(alice.auth)
        .send({ name: 'Khác', color: '#000000' })
        .expect(201);
      await http()
        .put(`/api/v1/nodes/${folder}/tags`)
        .set(alice.auth)
        .send({ tagIds: [foreign.body.id] })
        .expect(400);
      await share(alice, folder, 'viewer@lunatech.vn', 'VIEWER').expect(201);
      await http()
        .put(`/api/v1/nodes/${folder}/tags`)
        .set(viewer.auth)
        .send({ tagIds: [] })
        .expect(403);
    });

    it('sửa/xóa tag chỉ System Admin; xóa tag gỡ khỏi mục', async () => {
      await http().patch(`/api/v1/tags/${tagId}`).set(alice.auth).send({ name: 'Gấp' }).expect(403);
      await http().delete(`/api/v1/tags/${tagId}`).set(bob.auth).expect(403);
      await http().patch(`/api/v1/tags/${tagId}`).set(guest.auth).send({ name: 'Gấp' }).expect(404);
      const renamed = await http()
        .patch(`/api/v1/tags/${tagId}`)
        .set(sysadmin.auth)
        .send({ name: 'Gấp' })
        .expect(200);
      expect(renamed.body.name).toBe('Gấp');
      await http().delete(`/api/v1/tags/${tagId}`).set(sysadmin.auth).expect(204);
      const node = await http().get(`/api/v1/nodes/${folder}`).set(alice.auth).expect(200);
      expect(node.body.tags).toEqual([]);
    });

    it('yêu thích: thêm, liệt kê, bỏ; mục vào thùng rác thì biến mất khỏi danh sách', async () => {
      await http().put(`/api/v1/nodes/${folder}/favorite`).set(bob.auth).expect(204);
      await http().put(`/api/v1/nodes/${folder}/favorite`).set(bob.auth).expect(204);
      await http().put(`/api/v1/nodes/${folder}/favorite`).set(viewer.auth).expect(204);
      const fav = await http().get('/api/v1/me/favorites').set(bob.auth).expect(200);
      expect(
        fav.body.map((n: { id: string; isFavorite: boolean }) => [n.id, n.isFavorite]),
      ).toEqual([[folder, true]]);
      expect(
        (await http().get('/api/v1/me/favorites').set(viewer.auth).expect(200)).body,
      ).toHaveLength(1);
      await http().delete(`/api/v1/nodes/${folder}`).set(alice.auth).expect(204);
      expect((await http().get('/api/v1/me/favorites').set(bob.auth).expect(200)).body).toEqual([]);
      await http().post(`/api/v1/nodes/${folder}/restore`).set(alice.auth).expect(200);
      await http().delete(`/api/v1/nodes/${folder}/favorite`).set(bob.auth).expect(204);
      expect((await http().get('/api/v1/me/favorites').set(bob.auth).expect(200)).body).toEqual([]);
    });

    it('mở gần đây: ghi khi mở tài liệu, không ghi với folder', async () => {
      const doc = await ctx.prisma.node.create({
        data: {
          workspaceId: wsId,
          type: 'DOCUMENT',
          name: 'Biên bản họp',
          nameNormalized: 'biên bản họp',
          createdById: alice.userId,
        },
      });
      await http().get(`/api/v1/nodes/${folder}`).set(bob.auth).expect(200);
      await http().get(`/api/v1/nodes/${doc.id}`).set(bob.auth).expect(200);
      const recent = await http().get('/api/v1/me/recent').set(bob.auth).expect(200);
      expect(recent.body.map((r: { node: { id: string } }) => r.node.id)).toEqual([doc.id]);
    });
  });
});
