import { randomUUID } from 'node:crypto';
import { lockWorkspaceTree } from '@luna/db';
import request from 'supertest';
import { isNameConflict, isTreeViolation } from '../src/content/conflicts.js';
import { AppError } from '../src/common/errors/app-error.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';
import { treeInvariants, waitForLockWait } from './db-helpers.js';

describe('Tree races under the workspace lock (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let wsId: string;
  let f: string;
  let seq = 0;
  const http = () => request(ctx.app.getHttpServer());
  const clean = { liveUnderDeleted: 0, strandedInTrash: 0, badPaths: 0, cycles: 0 };

  const createFolder = (as: LoggedIn, name: string, parentId: string | null = null) =>
    http().post(`/api/v1/workspaces/${wsId}/folders`).set(as.auth).send({ name, parentId });
  const createDocument = (as: LoggedIn, name: string, parentId: string | null = null) =>
    http().post(`/api/v1/workspaces/${wsId}/documents`).set(as.auth).send({ name, parentId });
  const startUpload = (as: LoggedIn, fileName: string, parentId: string | null = null) =>
    http()
      .post(`/api/v1/workspaces/${wsId}/uploads`)
      .set(as.auth)
      .send({ fileName, size: 10, mime: 'application/pdf', parentId });
  const move = (as: LoggedIn, id: string, targetParentId: string | null) =>
    http().post(`/api/v1/nodes/${id}/move`).set(as.auth).send({ targetParentId });
  const trash = (as: LoggedIn, id: string) => http().delete(`/api/v1/nodes/${id}`).set(as.auth);
  const restore = (as: LoggedIn, id: string) =>
    http().post(`/api/v1/nodes/${id}/restore`).set(as.auth);

  const folderId = async (name: string, parentId: string | null = null) =>
    (await createFolder(alice, name, parentId).expect(201)).body.id as string;

  const twoRootFolders = async (i: number) =>
    Promise.all([folderId(`Chéo A ${i}`), folderId(`Chéo B ${i}`)]);

  const twoTrashedSameName = async (i: number) => {
    const parent = await folderId(`Cha khôi phục ${i}`);
    const x = await folderId('Trùng tên', parent);
    await trash(alice, x).expect(204);
    const y = await folderId('Trùng tên', parent);
    await trash(alice, y).expect(204);
    return [x, y] as const;
  };

  const trashInTx = (
    tx: Parameters<Parameters<TestContext['prisma']['$transaction']>[0]>[0],
    id: string,
  ) =>
    tx.$executeRaw`
      UPDATE nodes SET deleted_at = now(), deleted_root_id = ${id}::uuid, deleted_by = ${alice.userId}::uuid
       WHERE deleted_at IS NULL AND path <@ (SELECT path FROM nodes WHERE id = ${id}::uuid)`;

  const raceAgainstTrash = async (send: () => Promise<request.Response>) => {
    let res!: Promise<request.Response>;
    await ctx.prisma.$transaction(
      async (tx) => {
        await lockWorkspaceTree(tx, wsId);
        await trashInTx(tx, f);
        res = send().then((r) => r);
        await waitForLockWait(ctx.prisma, 5000);
      },
      { timeout: 15_000 },
    );
    return res;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    wsId = (
      await http()
        .post('/api/v1/workspaces')
        .set(alice.auth)
        .send({ name: 'Races', slug: 'races' })
        .expect(201)
    ).body.id;
  });

  beforeEach(async () => {
    f = await folderId(`Đích ${++seq}`);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('lỗi LT001 của trigger đến từ adapter dưới dạng mã, API nhận ra đó là vi phạm cây', async () => {
    const err = await ctx.prisma.node
      .create({
        data: {
          workspaceId: wsId,
          parentId: randomUUID(),
          type: 'FOLDER',
          name: 'mồ côi',
          nameNormalized: 'mồ côi',
          createdById: alice.userId,
        },
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      meta: { driverAdapterError: { cause: { kind: 'postgres', code: 'LT001' } } },
    });
    expect(isTreeViolation(err)).toBe(true);
    expect(isNameConflict(err)).toBe(false);

    const dup = await ctx.prisma.node
      .create({
        data: {
          workspaceId: wsId,
          parentId: null,
          type: 'FOLDER',
          name: `Đích ${seq}`,
          nameNormalized: `đích ${seq}`,
          createdById: alice.userId,
        },
      })
      .catch((e: unknown) => e);
    expect(isNameConflict(dup)).toBe(true);
    expect(isTreeViolation(dup)).toBe(false);
    expect(isTreeViolation(AppError.validation('tree-ish but not from the database'))).toBe(false);
    expect(isTreeViolation(undefined)).toBe(false);
  });

  it('tạo folder vào folder đang bị xoá: chờ xoá xong rồi trả 409, không có mục sống dưới cha đã xoá', async () => {
    const res = await raceAgainstTrash(() => createFolder(alice, 'Con', f));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(
      'The target folder was just moved or deleted, refresh and try again',
    );
    expect(await treeInvariants(ctx.prisma)).toEqual(clean);
  });

  it('tạo tài liệu vào folder đang bị xoá cũng trả 409', async () => {
    const res = await raceAgainstTrash(() => createDocument(alice, 'Ghi chú', f));
    expect(res.status).toBe(409);
    expect(await treeInvariants(ctx.prisma)).toEqual(clean);
  });

  it('bắt đầu tải file vào folder đang bị xoá cũng trả 409', async () => {
    const res = await raceAgainstTrash(() => startUpload(alice, 'hop-dong.pdf', f));
    expect(res.status).toBe(409);
    expect(await treeInvariants(ctx.prisma)).toEqual(clean);
  });

  it('chuyển mục vào folder đang bị xoá cũng trả 409', async () => {
    const doc = await folderId(`Lẻ ${seq}`);
    const res = await raceAgainstTrash(() => move(alice, doc, f));
    expect(res.status).toBe(409);
    expect(await treeInvariants(ctx.prisma)).toEqual(clean);
  });

  it('di chuyển giữ khoá trước, xoá cha đến sau: mục vừa chuyển vào cũng vào thùng rác', async () => {
    const d = await folderId(`Đi trước ${seq}`);
    let res!: Promise<request.Response>;
    await ctx.prisma.$transaction(
      async (tx) => {
        await lockWorkspaceTree(tx, wsId);
        await tx.node.update({ where: { id: d }, data: { parentId: f } });
        res = trash(alice, f).then((r) => r);
        await waitForLockWait(ctx.prisma, 5000);
      },
      { timeout: 15_000 },
    );
    expect((await res).status).toBe(204);
    const moved = await ctx.prisma.node.findUniqueOrThrow({ where: { id: d } });
    expect(moved).toMatchObject({ parentId: f, deletedRootId: f });
    expect(moved.deletedAt).not.toBeNull();
    expect(await treeInvariants(ctx.prisma)).toEqual(clean);
  });

  it('xoá cha đến trước, di chuyển mục con ra folder sống đến sau: trả 409, mục con vẫn nằm trong thùng rác cùng cha', async () => {
    const p = await folderId(`Cha bị xoá ${seq}`);
    const x = await folderId('Con sắp chuyển', p);
    let trashed!: Promise<request.Response>;
    let moved!: Promise<request.Response>;
    await ctx.prisma.$transaction(
      async (tx) => {
        await lockWorkspaceTree(tx, wsId);
        trashed = trash(alice, p).then((r) => r);
        await waitForLockWait(ctx.prisma, 5000, 1);
        moved = move(alice, x, f).then((r) => r);
        await waitForLockWait(ctx.prisma, 5000, 2);
      },
      { timeout: 15_000 },
    );
    expect((await trashed).status).toBe(204);
    const res = await moved;
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(
      'This item was just moved or deleted, refresh and try again',
    );
    const row = await ctx.prisma.node.findUniqueOrThrow({ where: { id: x } });
    expect(row).toMatchObject({ parentId: p, deletedRootId: p });
    expect(row.deletedAt).not.toBeNull();
    expect(await treeInvariants(ctx.prisma)).toEqual(clean);
  });

  it('khôi phục vào cha đang bị xoá: chờ xoá xong rồi khôi phục ra gốc', async () => {
    const x = await folderId('Sẽ khôi phục', f);
    await trash(alice, x).expect(204);
    const res = await raceAgainstTrash(() => restore(alice, x));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ movedToRoot: true, node: { id: x, parentId: null } });
    expect(await treeInvariants(ctx.prisma)).toEqual(clean);
  });

  it('khôi phục và xoá vĩnh viễn cùng lúc: khôi phục đến trước thì mục còn sống, xoá vĩnh viễn trả 400', async () => {
    const x = await folderId(`Tranh chấp ${seq}`, f);
    const child = await folderId('Con của mục tranh chấp', x);
    await trash(alice, x).expect(204);
    let restored!: Promise<request.Response>;
    let purged!: Promise<request.Response>;
    await ctx.prisma.$transaction(
      async (tx) => {
        await lockWorkspaceTree(tx, wsId);
        restored = restore(alice, x).then((r) => r);
        await waitForLockWait(ctx.prisma, 5000, 1);
        purged = http()
          .delete(`/api/v1/nodes/${x}/permanent`)
          .set(alice.auth)
          .then((r) => r);
        await waitForLockWait(ctx.prisma, 5000, 2);
      },
      { timeout: 15_000 },
    );
    expect((await restored).status).toBe(200);
    const res = await purged;
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Item is not in the trash');
    const rows = await ctx.prisma.node.findMany({
      where: { id: { in: [x, child] } },
      select: { id: true, deletedAt: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.deletedAt === null)).toBe(true);
    expect(await treeInvariants(ctx.prisma)).toEqual(clean);
  });

  it('chờ khoá cây quá lâu thì bỏ cuộc và trả 503 để thử lại, không tạo gì', async () => {
    let res!: request.Response;
    await ctx.prisma.$transaction(
      async (tx) => {
        await lockWorkspaceTree(tx, wsId);
        res = await createFolder(alice, `Chờ lâu ${seq}`, f);
      },
      { timeout: 20_000 },
    );
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Someone else is changing this workspace right now, try again in a moment',
    });
    expect(await ctx.prisma.node.count({ where: { parentId: f } })).toBe(0);
  }, 30_000);

  it('hai lần di chuyển chéo A→B và B→A cùng lúc: đúng một lần thành công, cây không có vòng', async () => {
    for (let i = 0; i < 10; i++) {
      const [a, b] = await twoRootFolders(i);
      const [r1, r2] = await Promise.all([move(alice, a, b), move(alice, b, a)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 400]);
      expect(await treeInvariants(ctx.prisma)).toEqual(clean);
    }
  });

  it('khôi phục đồng thời hai mục trùng tên vào cùng folder: cả hai thành công, tên khác nhau', async () => {
    for (let i = 0; i < 5; i++) {
      const [x, y] = await twoTrashedSameName(i);
      const [r1, r2] = await Promise.all([restore(alice, x), restore(alice, y)]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(r1.body.name).not.toBe(r2.body.name);
      expect(await treeInvariants(ctx.prisma)).toEqual(clean);
    }
  });
});
