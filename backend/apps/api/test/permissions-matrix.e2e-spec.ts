import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  loginAsAdmin,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

type Persona = 'admin' | 'member' | 'viewer' | 'outsider';
const PERSONAS: Persona[] = ['admin', 'member', 'viewer', 'outsider'];

interface Ids {
  ws: string;
  folder: string;
  doc: string;
  file: string;
  tag: string;
  thread: string;
}

interface Case {
  name: string;
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: (ids: Ids) => string;
  body?: (ids: Ids, who: Persona, n: number) => object;
  expect: Record<Persona, number>;
  prepare?: (who: Persona) => Promise<Partial<Ids>>;
}

describe('Ma trận quyền: mọi endpoint với 4 vai trò (e2e)', () => {
  let ctx: TestContext;
  const as: Record<Persona, LoggedIn> = {} as never;
  let sysadmin: LoggedIn;
  const ids: Ids = {} as Ids;
  let n = 0;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    sysadmin = await loginAsAdmin(ctx);
    as.admin = await loginAs(ctx, 'm.admin@lunatech.vn');
    as.member = await loginAs(ctx, 'm.member@lunatech.vn');
    as.viewer = await loginAs(ctx, 'm.viewer@lunatech.vn');
    as.outsider = await loginAs(ctx, 'm.outsider@lunatech.vn');
    ids.ws = (
      await http()
        .post('/api/v1/workspaces')
        .set(as.admin.auth)
        .send({ name: 'Ma trận', slug: 'ma-tran', memberEmails: ['m.member@lunatech.vn'] })
        .expect(201)
    ).body.id;
    ids.folder = (
      await http()
        .post(`/api/v1/workspaces/${ids.ws}/folders`)
        .set(as.member.auth)
        .send({ name: 'Chung' })
        .expect(201)
    ).body.id;
    await http()
      .post(`/api/v1/nodes/${ids.folder}/shares`)
      .set(as.admin.auth)
      .send({ email: 'm.viewer@lunatech.vn', role: 'VIEWER' })
      .expect(201);
    ids.doc = (
      await http()
        .post(`/api/v1/workspaces/${ids.ws}/documents`)
        .set(as.member.auth)
        .send({ name: 'Tài liệu', parentId: ids.folder })
        .expect(201)
    ).body.node.id;
    ids.file = (
      await ctx.prisma.node.create({
        data: {
          workspaceId: ids.ws,
          parentId: ids.folder,
          type: 'FILE',
          name: 'a.pdf',
          nameNormalized: 'a.pdf',
          createdById: as.member.userId,
          file: { create: {} },
        },
      })
    ).id;
    ids.tag = (
      await http()
        .post(`/api/v1/workspaces/${ids.ws}/tags`)
        .set(as.member.auth)
        .send({ name: 'Nhãn', color: '#000000' })
        .expect(201)
    ).body.id;
    ids.thread = (
      await http()
        .post(`/api/v1/documents/${ids.doc}/threads`)
        .set(as.member.auth)
        .send({ body: 'Bình luận' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const freshNode = async () =>
    (
      await ctx.prisma.node.create({
        data: {
          workspaceId: ids.ws,
          parentId: ids.folder,
          type: 'FOLDER',
          name: `Xoá ${++n}`,
          nameNormalized: `xoá ${n}`,
          createdById: as.member.userId,
        },
      })
    ).id;

  const cases: Case[] = [
    {
      name: 'xem workspace',
      method: 'get',
      path: (i) => `/workspaces/${i.ws}`,
      expect: { admin: 200, member: 200, viewer: 404, outsider: 404 },
    },
    {
      name: 'xem thành viên',
      method: 'get',
      path: (i) => `/workspaces/${i.ws}/members`,
      expect: { admin: 200, member: 200, viewer: 404, outsider: 404 },
    },
    {
      name: 'liệt kê gốc',
      method: 'get',
      path: (i) => `/workspaces/${i.ws}/nodes`,
      expect: { admin: 200, member: 200, viewer: 404, outsider: 404 },
    },
    {
      name: 'liệt kê trong thư mục',
      method: 'get',
      path: (i) => `/workspaces/${i.ws}/nodes?parentId=${i.folder}`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'xem mục',
      method: 'get',
      path: (i) => `/nodes/${i.folder}`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'đường dẫn',
      method: 'get',
      path: (i) => `/nodes/${i.doc}/breadcrumb`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'xem tài liệu',
      method: 'get',
      path: (i) => `/documents/${i.doc}`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'collab token',
      method: 'get',
      path: (i) => `/documents/${i.doc}/collab-token`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'phiên bản',
      method: 'get',
      path: (i) => `/documents/${i.doc}/versions`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'bình luận',
      method: 'get',
      path: (i) => `/documents/${i.doc}/threads`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'xuất markdown',
      method: 'get',
      path: (i) => `/documents/${i.doc}/export?format=md`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'xem tệp',
      method: 'get',
      path: (i) => `/files/${i.file}`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'phiên bản tệp',
      method: 'get',
      path: (i) => `/files/${i.file}/versions`,
      expect: { admin: 200, member: 200, viewer: 200, outsider: 404 },
    },
    {
      name: 'danh sách share',
      method: 'get',
      path: (i) => `/nodes/${i.folder}/shares`,
      expect: { admin: 200, member: 403, viewer: 403, outsider: 404 },
    },
    {
      name: 'hoạt động',
      method: 'get',
      path: (i) => `/nodes/${i.doc}/activity`,
      expect: { admin: 200, member: 403, viewer: 403, outsider: 404 },
    },
    {
      name: 'thùng rác',
      method: 'get',
      path: (i) => `/workspaces/${i.ws}/trash`,
      expect: { admin: 200, member: 200, viewer: 404, outsider: 404 },
    },
    {
      name: 'tag',
      method: 'get',
      path: (i) => `/workspaces/${i.ws}/tags`,
      expect: { admin: 200, member: 200, viewer: 404, outsider: 404 },
    },
    {
      name: 'đổi tên',
      method: 'patch',
      path: (i) => `/nodes/${i.doc}`,
      body: (_i, w, k) => ({ name: `Đổi ${w} ${k}` }),
      expect: { admin: 200, member: 200, viewer: 403, outsider: 404 },
    },
    {
      name: 'tạo thư mục con',
      method: 'post',
      path: (i) => `/workspaces/${i.ws}/folders`,
      body: (i, w, k) => ({ name: `Con ${w} ${k}`, parentId: i.folder }),
      expect: { admin: 201, member: 201, viewer: 403, outsider: 404 },
    },
    {
      name: 'tạo ở gốc',
      method: 'post',
      path: (i) => `/workspaces/${i.ws}/folders`,
      body: (_i, w, k) => ({ name: `Gốc ${w} ${k}` }),
      expect: { admin: 201, member: 201, viewer: 404, outsider: 404 },
    },
    {
      name: 'tạo tài liệu',
      method: 'post',
      path: (i) => `/workspaces/${i.ws}/documents`,
      body: (i, w, k) => ({ name: `Doc ${w} ${k}`, parentId: i.folder }),
      expect: { admin: 201, member: 201, viewer: 403, outsider: 404 },
    },
    {
      name: 'mở thread',
      method: 'post',
      path: (i) => `/documents/${i.doc}/threads`,
      body: () => ({ body: 'Góp ý' }),
      expect: { admin: 201, member: 201, viewer: 201, outsider: 404 },
    },
    {
      name: 'trả lời',
      method: 'post',
      path: (i) => `/threads/${i.thread}/comments`,
      body: () => ({ body: 'Trả lời' }),
      expect: { admin: 201, member: 201, viewer: 201, outsider: 404 },
    },
    {
      name: 'gắn tag',
      method: 'put',
      path: (i) => `/nodes/${i.doc}/tags`,
      body: () => ({ tagIds: [] }),
      expect: { admin: 200, member: 200, viewer: 403, outsider: 404 },
    },
    {
      name: 'thêm share',
      method: 'post',
      path: (i) => `/nodes/${i.folder}/shares`,
      body: (_i, w) => ({ email: `s.${w}@lunatech.vn`, role: 'VIEWER' }),
      expect: { admin: 201, member: 403, viewer: 403, outsider: 404 },
    },
    {
      name: 'sửa workspace',
      method: 'patch',
      path: (i) => `/workspaces/${i.ws}`,
      body: (_i, w) => ({ name: `Ma trận ${w}` }),
      expect: { admin: 200, member: 403, viewer: 404, outsider: 404 },
    },
    {
      name: 'mời thành viên',
      method: 'post',
      path: (i) => `/workspaces/${i.ws}/members`,
      body: (_i, w) => ({ email: `inv.${w}@lunatech.vn` }),
      expect: { admin: 201, member: 403, viewer: 404, outsider: 404 },
    },
    {
      name: 'sửa tag',
      method: 'patch',
      path: (i) => `/tags/${i.tag}`,
      body: (_i, w) => ({ name: `Nhãn ${w}` }),
      expect: { admin: 200, member: 403, viewer: 404, outsider: 404 },
    },
    {
      name: 'dọn thùng rác',
      method: 'delete',
      path: (i) => `/workspaces/${i.ws}/trash`,
      expect: { admin: 200, member: 403, viewer: 404, outsider: 404 },
    },
    {
      name: 'quản trị hệ thống',
      method: 'get',
      path: () => '/admin/users',
      expect: { admin: 403, member: 403, viewer: 403, outsider: 403 },
    },
  ];

  it.each(cases)('$name', async (c) => {
    const got: Record<string, number> = {};
    for (const who of PERSONAS) {
      const req = http()
        [c.method](`/api/v1${c.path(ids)}`)
        .set(as[who].auth);
      const res = c.body ? await req.send(c.body(ids, who, ++n)) : await req;
      got[who] = res.status;
    }
    expect(got).toEqual(c.expect);
  });

  it('xoá vào thùng rác: quản trị và thành viên được, người được share chỉ xem bị chặn, người ngoài không thấy', async () => {
    const got: Record<string, number> = {};
    for (const who of PERSONAS) {
      const id = await freshNode();
      got[who] = (await http().delete(`/api/v1/nodes/${id}`).set(as[who].auth)).status;
    }
    expect(got).toEqual({ admin: 204, member: 204, viewer: 403, outsider: 404 });
  });

  it('khôi phục và xoá vĩnh viễn: thành viên khôi phục mục mình xoá, chỉ quản trị xoá vĩnh viễn', async () => {
    const a = await freshNode();
    await http().delete(`/api/v1/nodes/${a}`).set(as.admin.auth).expect(204);
    await http().post(`/api/v1/nodes/${a}/restore`).set(as.member.auth).expect(403);
    await http().post(`/api/v1/nodes/${a}/restore`).set(as.viewer.auth).expect(404);
    await http().post(`/api/v1/nodes/${a}/restore`).set(as.outsider.auth).expect(404);
    await http().post(`/api/v1/nodes/${a}/restore`).set(as.admin.auth).expect(200);
    const b = await freshNode();
    await http().delete(`/api/v1/nodes/${b}`).set(as.member.auth).expect(204);
    await http().delete(`/api/v1/nodes/${b}/permanent`).set(as.member.auth).expect(403);
    await http().delete(`/api/v1/nodes/${b}/permanent`).set(as.admin.auth).expect(204);
    await http().post(`/api/v1/nodes/${b}/restore`).set(sysadmin.auth).expect(404);
  });
});
