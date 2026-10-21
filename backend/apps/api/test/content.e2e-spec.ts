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
  let owner: LoggedIn;
  let admin: LoggedIn;
  let editor: LoggedIn;
  let viewer: LoggedIn;
  let guest: LoggedIn;
  let wsId: string;
  let otherWsId: string;
  const http = () => request(ctx.app.getHttpServer());

  const createFolder = (as: LoggedIn, name: string, parentId: string | null = null, ws = wsId) =>
    http().post(`/api/v1/workspaces/${ws}/folders`).set(as.auth).send({ name, parentId });

  const list = (as: LoggedIn, parentId?: string, query = '') =>
    http()
      .get(`/api/v1/workspaces/${wsId}/nodes?${parentId ? `parentId=${parentId}&` : ''}${query}`)
      .set(as.auth);

  const names = (res: request.Response) => res.body.items.map((n: { name: string }) => n.name);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    sysadmin = await loginAsAdmin(ctx);
    owner = await loginAs(ctx, 'owner@lunatech.vn');
    admin = await loginAs(ctx, 'admin.member@lunatech.vn');
    editor = await loginAs(ctx, 'editor@lunatech.vn');
    viewer = await loginAs(ctx, 'viewer@lunatech.vn');
    guest = await loginAs(ctx, 'guest@lunatech.vn');

    const ws = await http()
      .post('/api/v1/workspaces')
      .set(sysadmin.auth)
      .send({ name: 'Docs', slug: 'docs', ownerEmail: 'owner@lunatech.vn' })
      .expect(201);
    wsId = ws.body.id;
    for (const [email, role] of [
      ['admin.member@lunatech.vn', 'ADMIN'],
      ['editor@lunatech.vn', 'EDITOR'],
      ['viewer@lunatech.vn', 'VIEWER'],
    ]) {
      await http()
        .post(`/api/v1/workspaces/${wsId}/members`)
        .set(owner.auth)
        .send({ email, role })
        .expect(201);
    }
    const other = await http()
      .post('/api/v1/workspaces')
      .set(sysadmin.auth)
      .send({ name: 'Other', slug: 'other', ownerEmail: 'owner@lunatech.vn' })
      .expect(201);
    otherWsId = other.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('folders', () => {
    it('EDITOR tạo folder ở gốc và lồng nhau; VIEWER không tạo được; người ngoài 404', async () => {
      const root = await createFolder(editor, 'Dự án').expect(201);
      expect(root.body).toMatchObject({
        type: 'FOLDER',
        name: 'Dự án',
        myRole: 'EDITOR',
        childCount: 0,
      });
      await createFolder(editor, 'Thiết kế', root.body.id).expect(201);
      await createFolder(viewer, 'Không được').expect(403);
      await createFolder(guest, 'Không được').expect(404);
      await list(sysadmin).expect(404);
    });

    it('trùng tên (không phân biệt hoa thường, NFC) → 409 kèm gợi ý', async () => {
      const decomposed = 'Du\u031b\u0323 a\u0301n';
      expect(decomposed.normalize('NFC')).toBe('Dự án');
      const res = await createFolder(editor, `  ${decomposed.toUpperCase()} `).expect(409);
      expect(res.body.error.details.suggestion).toBe('DỰ ÁN (1)');
    });

    it('tên không hợp lệ → 400', async () => {
      await createFolder(editor, 'a/b').expect(400);
      await createFolder(editor, '   ').expect(400);
    });

    it('liệt kê: folder trước, sắp xếp, phân trang', async () => {
      const parent = (await createFolder(editor, 'Sắp xếp').expect(201)).body.id;
      for (const n of ['b', 'C', 'a']) await createFolder(editor, n, parent).expect(201);
      await ctx.prisma.node.create({
        data: {
          workspaceId: wsId,
          parentId: parent,
          type: 'DOCUMENT',
          name: 'aaa doc',
          nameNormalized: 'aaa doc',
          createdById: editor.userId,
        },
      });
      const all = await list(viewer, parent).expect(200);
      expect(names(all)).toEqual(['a', 'b', 'C', 'aaa doc']);
      expect(all.body.items[0].myRole).toBe('VIEWER');

      const desc = await list(viewer, parent, 'order=desc').expect(200);
      expect(names(desc)).toEqual(['C', 'b', 'a', 'aaa doc']);

      const p1 = await list(viewer, parent, 'limit=2').expect(200);
      expect(names(p1)).toEqual(['a', 'b']);
      const p2 = await list(viewer, parent, `limit=2&cursor=${p1.body.nextCursor}`).expect(200);
      expect(names(p2)).toEqual(['C', 'aaa doc']);
      expect(p2.body.nextCursor).toBeNull();

      const onlyDocs = await list(viewer, parent, 'type=DOCUMENT').expect(200);
      expect(names(onlyDocs)).toEqual(['aaa doc']);
    });

    it('đổi tên; trùng tên khi đổi → 409', async () => {
      const a = (await createFolder(editor, 'Tên A').expect(201)).body.id;
      await createFolder(editor, 'Tên B').expect(201);
      const res = await http()
        .patch(`/api/v1/nodes/${a}`)
        .set(editor.auth)
        .send({ name: 'Tên A mới' })
        .expect(200);
      expect(res.body.name).toBe('Tên A mới');
      await http().patch(`/api/v1/nodes/${a}`).set(editor.auth).send({ name: 'tên b' }).expect(409);
      await http()
        .patch(`/api/v1/nodes/${a}`)
        .set(editor.auth)
        .send({ name: 'TÊN A MỚI' })
        .expect(200);
      await http().patch(`/api/v1/nodes/${a}`).set(viewer.auth).send({ name: 'x' }).expect(403);
    });
  });

  describe('move & breadcrumb', () => {
    let a: string;
    let b: string;
    let c: string;
    let target: string;

    beforeAll(async () => {
      a = (await createFolder(editor, 'Move A').expect(201)).body.id;
      b = (await createFolder(editor, 'Move B', a).expect(201)).body.id;
      c = (await createFolder(editor, 'Move C', b).expect(201)).body.id;
      target = (await createFolder(editor, 'Move Target').expect(201)).body.id;
    });

    const crumb = async (id: string, as = editor) =>
      (await http().get(`/api/v1/nodes/${id}/breadcrumb`).set(as.auth).expect(200)).body.map(
        (x: { name: string }) => x.name,
      );

    it('breadcrumb đầy đủ cho thành viên', async () => {
      expect(await crumb(c)).toEqual(['Move A', 'Move B', 'Move C']);
    });

    it('di chuyển cả nhánh: path của cây con được cập nhật', async () => {
      await http()
        .post(`/api/v1/nodes/${b}/move`)
        .set(editor.auth)
        .send({ targetParentId: target })
        .expect(200);
      expect(await crumb(c)).toEqual(['Move Target', 'Move B', 'Move C']);
      const children = await list(editor, a).expect(200);
      expect(children.body.items).toEqual([]);
      await http()
        .post(`/api/v1/nodes/${c}/move`)
        .set(editor.auth)
        .send({ targetParentId: null })
        .expect(200);
      expect(await crumb(c)).toEqual(['Move C']);
    });

    it('không di chuyển folder vào chính nó hoặc cây con của nó', async () => {
      await http()
        .post(`/api/v1/nodes/${target}/move`)
        .set(editor.auth)
        .send({ targetParentId: target })
        .expect(400);
      const res = await http()
        .post(`/api/v1/nodes/${target}/move`)
        .set(editor.auth)
        .send({ targetParentId: b })
        .expect(400);
      expect(res.body.error.message).toMatch(/own subfolder/);
    });

    it('không di chuyển sang workspace khác; VIEWER không di chuyển được', async () => {
      const foreign = (await createFolder(owner, 'Foreign', null, otherWsId).expect(201)).body.id;
      await http()
        .post(`/api/v1/nodes/${b}/move`)
        .set(owner.auth)
        .send({ targetParentId: foreign })
        .expect(400);
      await http()
        .post(`/api/v1/nodes/${b}/move`)
        .set(viewer.auth)
        .send({ targetParentId: a })
        .expect(403);
    });

    it('trùng tên ở folder đích → 409', async () => {
      await createFolder(editor, 'Move B', a).expect(201);
      await http()
        .post(`/api/v1/nodes/${b}/move`)
        .set(editor.auth)
        .send({ targetParentId: a })
        .expect(409);
    });
  });

  describe('sharing', () => {
    let shared: string;
    let sub: string;
    let shareId: string;

    beforeAll(async () => {
      const parent = (await createFolder(editor, 'Phòng ban').expect(201)).body.id;
      shared = (await createFolder(editor, 'Chia sẻ', parent).expect(201)).body.id;
      sub = (await createFolder(editor, 'Con', shared).expect(201)).body.id;
    });

    it('chỉ ADMIN workspace quản lý share', async () => {
      await http()
        .post(`/api/v1/nodes/${shared}/shares`)
        .set(editor.auth)
        .send({ email: 'guest@lunatech.vn', role: 'VIEWER' })
        .expect(403);
      const res = await http()
        .post(`/api/v1/nodes/${shared}/shares`)
        .set(admin.auth)
        .send({ email: 'guest@lunatech.vn', role: 'VIEWER' })
        .expect(201);
      expect(res.body).toMatchObject({ role: 'VIEWER', user: { email: 'guest@lunatech.vn' } });
      shareId = res.body.id;
      await http()
        .post(`/api/v1/nodes/${shared}/shares`)
        .set(admin.auth)
        .send({ email: 'guest@lunatech.vn', role: 'EDITOR' })
        .expect(409);
    });

    it('người được share (ngoài workspace) xem được folder và cả cây con, không xem được gốc', async () => {
      const children = await list(guest, shared).expect(200);
      expect(names(children)).toEqual(['Con']);
      expect(children.body.items[0].myRole).toBe('VIEWER');
      await http().get(`/api/v1/nodes/${sub}`).set(guest.auth).expect(200);
      await list(guest).expect(404);
      await http().get(`/api/v1/workspaces/${wsId}`).set(guest.auth).expect(404);
      await createFolder(guest, 'x', shared).expect(403);
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
        sharedBy: { email: 'admin.member@lunatech.vn' },
      });
    });

    it('nâng share lên EDITOR → được tạo mục bên trong nhưng không tạo ở gốc', async () => {
      await http()
        .patch(`/api/v1/nodes/${shared}/shares/${shareId}`)
        .set(admin.auth)
        .send({ role: 'EDITOR' })
        .expect(200);
      await createFolder(guest, 'Của khách', sub).expect(201);
      await createFolder(guest, 'Của khách').expect(404);
      await http().get(`/api/v1/nodes/${shared}/shares`).set(guest.auth).expect(403);
    });

    it('share cộng thêm quyền: VIEWER của workspace được share EDITOR thì sửa được', async () => {
      await http()
        .patch(`/api/v1/nodes/${sub}`)
        .set(viewer.auth)
        .send({ name: 'Con 2' })
        .expect(403);
      await http()
        .post(`/api/v1/nodes/${shared}/shares`)
        .set(owner.auth)
        .send({ email: 'viewer@lunatech.vn', role: 'EDITOR' })
        .expect(201);
      await http().patch(`/api/v1/nodes/${sub}`).set(viewer.auth).send({ name: 'Con' }).expect(200);
    });

    it('danh sách share hiển thị share kế thừa ở folder con', async () => {
      const res = await http().get(`/api/v1/nodes/${sub}/shares`).set(admin.auth).expect(200);
      expect(res.body.direct).toEqual([]);
      expect(
        res.body.inherited.map((s: { user: { email: string } }) => s.user.email).sort(),
      ).toEqual(['guest@lunatech.vn', 'viewer@lunatech.vn']);
      expect(res.body.inherited[0].fromNode).toEqual({ id: shared, name: 'Chia sẻ' });
    });

    it('thu hồi share → mất quyền ngay', async () => {
      await http().delete(`/api/v1/nodes/${shared}/shares/${shareId}`).set(admin.auth).expect(204);
      await http().get(`/api/v1/nodes/${sub}`).set(guest.auth).expect(404);
      const res = await http().get('/api/v1/shared-with-me').set(guest.auth).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('trash', () => {
    let root: string;
    let child: string;

    beforeAll(async () => {
      root = (await createFolder(editor, 'Rác').expect(201)).body.id;
      child = (await createFolder(editor, 'Rác con', root).expect(201)).body.id;
      await createFolder(editor, 'Rác cháu', child).expect(201);
    });

    it('EDITOR chỉ xóa mục do mình tạo; ADMIN xóa mọi mục', async () => {
      const ownersFolder = (await createFolder(owner, 'Của owner').expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${ownersFolder}`).set(editor.auth).expect(403);
      await http().delete(`/api/v1/nodes/${ownersFolder}`).set(admin.auth).expect(204);
    });

    it('xóa cả nhánh vào thùng rác; mục con không còn truy cập', async () => {
      await http().delete(`/api/v1/nodes/${root}`).set(editor.auth).expect(204);
      await http().get(`/api/v1/nodes/${child}`).set(editor.auth).expect(404);
      const trash = await http()
        .get(`/api/v1/workspaces/${wsId}/trash`)
        .set(editor.auth)
        .expect(200);
      const item = trash.body.find((t: { id: string }) => t.id === root);
      expect(item).toMatchObject({
        name: 'Rác',
        itemCount: 3,
        deletedBy: { email: 'editor@lunatech.vn' },
      });
      await http().get(`/api/v1/workspaces/${wsId}/trash`).set(viewer.auth).expect(403);
    });

    it('chỉ khôi phục được mục gốc của lần xóa', async () => {
      const res = await http().post(`/api/v1/nodes/${child}/restore`).set(editor.auth).expect(400);
      expect(res.body.error.message).toMatch(/parent folder/);
    });

    it('khôi phục cả nhánh về chỗ cũ; trùng tên thì tự đổi tên', async () => {
      await createFolder(editor, 'Rác').expect(201);
      const res = await http().post(`/api/v1/nodes/${root}/restore`).set(editor.auth).expect(200);
      expect(res.body).toMatchObject({
        movedToRoot: false,
        renamed: true,
        node: { name: 'Rác (1)', childCount: 1 },
      });
      await http().get(`/api/v1/nodes/${child}`).set(editor.auth).expect(200);
    });

    it('folder cha đã bị xóa → khôi phục về gốc workspace', async () => {
      await http().delete(`/api/v1/nodes/${child}`).set(editor.auth).expect(204);
      await http().delete(`/api/v1/nodes/${root}`).set(editor.auth).expect(204);
      const res = await http().post(`/api/v1/nodes/${child}/restore`).set(editor.auth).expect(200);
      expect(res.body).toMatchObject({ movedToRoot: true, node: { parentId: null } });
      const crumb = await http()
        .get(`/api/v1/nodes/${child}/breadcrumb`)
        .set(editor.auth)
        .expect(200);
      expect(crumb.body.map((x: { name: string }) => x.name)).toEqual(['Rác con']);
    });

    it('EDITOR không khôi phục mục người khác xóa', async () => {
      const f = (await createFolder(editor, 'Admin xóa').expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${f}`).set(admin.auth).expect(204);
      await http().post(`/api/v1/nodes/${f}/restore`).set(editor.auth).expect(403);
      await http().post(`/api/v1/nodes/${f}/restore`).set(admin.auth).expect(200);
    });

    it('xóa vĩnh viễn chỉ OWNER; xóa cả nhánh khỏi DB', async () => {
      await http().delete(`/api/v1/nodes/${root}/permanent`).set(admin.auth).expect(403);
      await http().delete(`/api/v1/nodes/${root}/permanent`).set(owner.auth).expect(204);
      expect(await ctx.prisma.node.count({ where: { id: root } })).toBe(0);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'node.delete_permanent', targetId: root },
        }),
      ).toBe(1);
    });

    it('dọn sạch thùng rác (OWNER)', async () => {
      const f = (await createFolder(editor, 'Dọn').expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${f}`).set(editor.auth).expect(204);
      await http().delete(`/api/v1/workspaces/${wsId}/trash`).set(editor.auth).expect(403);
      const res = await http()
        .delete(`/api/v1/workspaces/${wsId}/trash`)
        .set(owner.auth)
        .expect(200);
      expect(res.body.deleted).toBeGreaterThanOrEqual(1);
      const trash = await http()
        .get(`/api/v1/workspaces/${wsId}/trash`)
        .set(owner.auth)
        .expect(200);
      expect(trash.body).toEqual([]);
    });

    it('job dọn thùng rác chỉ xóa mục quá 30 ngày', async () => {
      const oldF = (await createFolder(editor, 'Cũ').expect(201)).body.id;
      const newF = (await createFolder(editor, 'Mới').expect(201)).body.id;
      await http().delete(`/api/v1/nodes/${oldF}`).set(editor.auth).expect(204);
      await http().delete(`/api/v1/nodes/${newF}`).set(editor.auth).expect(204);
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
      folder = (await createFolder(editor, 'Có tag').expect(201)).body.id;
    });

    it('tạo tag (EDITOR), trùng tên 409, VIEWER không tạo được', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${wsId}/tags`)
        .set(editor.auth)
        .send({ name: 'Quan trọng', color: '#FF0000' })
        .expect(201);
      expect(res.body.color).toBe('#ff0000');
      tagId = res.body.id;
      await http()
        .post(`/api/v1/workspaces/${wsId}/tags`)
        .set(editor.auth)
        .send({ name: 'Quan trọng', color: '#00ff00' })
        .expect(409);
      await http()
        .post(`/api/v1/workspaces/${wsId}/tags`)
        .set(viewer.auth)
        .send({ name: 'x', color: '#00ff00' })
        .expect(403);
      await http()
        .post(`/api/v1/workspaces/${wsId}/tags`)
        .set(editor.auth)
        .send({ name: 'y', color: 'red' })
        .expect(400);
    });

    it('gán tag cho mục; tag của workspace khác → 400', async () => {
      const res = await http()
        .put(`/api/v1/nodes/${folder}/tags`)
        .set(editor.auth)
        .send({ tagIds: [tagId] })
        .expect(200);
      expect(res.body.tags).toEqual([{ id: tagId, name: 'Quan trọng', color: '#ff0000' }]);
      const foreign = await http()
        .post(`/api/v1/workspaces/${otherWsId}/tags`)
        .set(owner.auth)
        .send({ name: 'Khác', color: '#000000' })
        .expect(201);
      await http()
        .put(`/api/v1/nodes/${folder}/tags`)
        .set(editor.auth)
        .send({ tagIds: [foreign.body.id] })
        .expect(400);
    });

    it('sửa/xóa tag chỉ ADMIN; xóa tag gỡ khỏi mục', async () => {
      await http()
        .patch(`/api/v1/tags/${tagId}`)
        .set(editor.auth)
        .send({ name: 'Gấp' })
        .expect(403);
      await http().patch(`/api/v1/tags/${tagId}`).set(admin.auth).send({ name: 'Gấp' }).expect(200);
      await http().delete(`/api/v1/tags/${tagId}`).set(admin.auth).expect(204);
      const node = await http().get(`/api/v1/nodes/${folder}`).set(editor.auth).expect(200);
      expect(node.body.tags).toEqual([]);
    });

    it('yêu thích: thêm, liệt kê, bỏ; mục vào thùng rác thì biến mất khỏi danh sách', async () => {
      await http().put(`/api/v1/nodes/${folder}/favorite`).set(viewer.auth).expect(204);
      await http().put(`/api/v1/nodes/${folder}/favorite`).set(viewer.auth).expect(204);
      const fav = await http().get('/api/v1/me/favorites').set(viewer.auth).expect(200);
      expect(
        fav.body.map((n: { id: string; isFavorite: boolean }) => [n.id, n.isFavorite]),
      ).toEqual([[folder, true]]);
      await http().delete(`/api/v1/nodes/${folder}`).set(editor.auth).expect(204);
      expect((await http().get('/api/v1/me/favorites').set(viewer.auth).expect(200)).body).toEqual(
        [],
      );
      await http().post(`/api/v1/nodes/${folder}/restore`).set(editor.auth).expect(200);
      await http().delete(`/api/v1/nodes/${folder}/favorite`).set(viewer.auth).expect(204);
      expect((await http().get('/api/v1/me/favorites').set(viewer.auth).expect(200)).body).toEqual(
        [],
      );
    });

    it('mở gần đây: ghi khi mở tài liệu, không ghi với folder', async () => {
      const doc = await ctx.prisma.node.create({
        data: {
          workspaceId: wsId,
          type: 'DOCUMENT',
          name: 'Biên bản họp',
          nameNormalized: 'biên bản họp',
          createdById: editor.userId,
        },
      });
      await http().get(`/api/v1/nodes/${folder}`).set(viewer.auth).expect(200);
      await http().get(`/api/v1/nodes/${doc.id}`).set(viewer.auth).expect(200);
      const recent = await http().get('/api/v1/me/recent').set(viewer.auth).expect(200);
      expect(recent.body.map((r: { node: { id: string } }) => r.node.id)).toEqual([doc.id]);
    });
  });
});
