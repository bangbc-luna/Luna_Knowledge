import { randomUUID } from 'node:crypto';
import { createTestApp, resetDatabase, type TestContext } from './create-test-app.js';
import { treeInvariants, waitForLockWait } from './db-helpers.js';

describe('Tree guard trigger (e2e)', () => {
  let ctx: TestContext;
  let userId: string;
  let wsId: string;
  let otherWsId: string;
  let folder: string;
  let seq = 0;

  const createNode = async ({
    parentId = null,
    type = 'FOLDER',
    section = 'DOCS',
    workspaceId = wsId,
  }: {
    parentId?: string | null;
    type?: 'FOLDER' | 'DOCUMENT' | 'FILE' | 'VIDEO';
    section?: 'DOCS' | 'VIDEOS';
    workspaceId?: string;
  } = {}) => {
    const name = `node ${++seq}`;
    const node = await ctx.prisma.node.create({
      data: {
        workspaceId,
        parentId,
        type,
        section,
        name,
        nameNormalized: name,
        createdById: userId,
      },
    });
    return node.id;
  };

  const trash = (id: string) =>
    ctx.prisma.$executeRaw`
      UPDATE nodes SET deleted_at = now(), deleted_root_id = ${id}::uuid, deleted_by = ${userId}::uuid
       WHERE deleted_at IS NULL AND path <@ (SELECT path FROM nodes WHERE id = ${id}::uuid)`;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userId = (await ctx.prisma.user.create({ data: { email: 'tree@lunatech.vn', name: 'Tree' } }))
      .id;
    wsId = (
      await ctx.prisma.workspace.create({
        data: { name: 'Tree', slug: 'tree', createdById: userId },
      })
    ).id;
    otherWsId = (
      await ctx.prisma.workspace.create({
        data: { name: 'Other tree', slug: 'other-tree', createdById: userId },
      })
    ).id;
  });

  beforeEach(async () => {
    folder = await createNode();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('không tạo được mục dưới folder đã vào thùng rác', async () => {
    await ctx.prisma.node.update({
      where: { id: folder },
      data: { deletedAt: new Date(), deletedRootId: folder },
    });
    await expect(createNode({ parentId: folder })).rejects.toThrow(/tree: parent is in the trash/);
  });

  it('không chuyển được mục sống vào folder đã vào thùng rác', async () => {
    const doc = await createNode({ type: 'DOCUMENT' });
    await trash(folder);
    await expect(
      ctx.prisma.node.update({ where: { id: doc }, data: { parentId: folder } }),
    ).rejects.toThrow(/tree: parent is in the trash/);
  });

  it('không tạo được mục dưới cha không tồn tại', async () => {
    await expect(createNode({ parentId: randomUUID() })).rejects.toThrow(/tree: parent not found/);
  });

  it('không tạo được mục dưới mục không phải FOLDER', async () => {
    const doc = await createNode({ parentId: folder, type: 'DOCUMENT' });
    await expect(createNode({ parentId: doc })).rejects.toThrow(/tree: parent is not a folder/);
  });

  it('không gắn được vào cha khác workspace hoặc khác section', async () => {
    await expect(createNode({ parentId: folder, workspaceId: otherWsId })).rejects.toThrow(
      /tree: parent is in another workspace or section/,
    );
    await expect(createNode({ parentId: folder, section: 'VIDEOS' })).rejects.toThrow(
      /tree: parent is in another workspace or section/,
    );
    const foreign = await createNode({ workspaceId: otherWsId, type: 'DOCUMENT' });
    await expect(
      ctx.prisma.node.update({ where: { id: foreign }, data: { parentId: folder } }),
    ).rejects.toThrow(/tree: parent is in another workspace or section/);
  });

  it('move tạo vòng bị chặn ở trigger', async () => {
    const a = await createNode({ parentId: folder });
    const childOfA = await createNode({ parentId: a });
    const grandChild = await createNode({ parentId: childOfA });
    await expect(
      ctx.prisma.node.update({ where: { id: a }, data: { parentId: childOfA } }),
    ).rejects.toThrow(/tree: move would create a cycle/);
    await expect(
      ctx.prisma.node.update({ where: { id: a }, data: { parentId: grandChild } }),
    ).rejects.toThrow(/tree: move would create a cycle/);
    await expect(
      ctx.prisma.node.update({ where: { id: a }, data: { parentId: a } }),
    ).rejects.toThrow(/tree: move would create a cycle/);
    expect(await treeInvariants(ctx.prisma)).toMatchObject({ badPaths: 0, cycles: 0 });
  });

  it('trigger chờ transaction đang xoá cha commit rồi mới quyết định', async () => {
    let insert!: Promise<unknown>;
    await ctx.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`UPDATE nodes SET deleted_at = now(), deleted_root_id = id WHERE id = ${folder}::uuid`;
        insert = createNode({ parentId: folder }).catch((e: Error) => e);
        await waitForLockWait(ctx.prisma, 5000);
      },
      { timeout: 15_000 },
    );
    expect(String(await insert)).toMatch(/tree: parent is in the trash/);
    expect((await treeInvariants(ctx.prisma)).liveUnderDeleted).toBe(0);
  });

  it('di chuyển về gốc và khôi phục mục gốc của thùng rác vẫn chạy', async () => {
    const sub = await createNode({ parentId: folder });
    const leaf = await createNode({ parentId: sub, type: 'DOCUMENT' });
    const moved = await createNode({ parentId: sub });
    await ctx.prisma.node.update({ where: { id: moved }, data: { parentId: null } });
    await ctx.prisma.node.update({ where: { id: moved }, data: { parentId: folder } });

    await trash(sub);
    await ctx.prisma.node.update({ where: { id: sub }, data: { parentId: folder } });
    await ctx.prisma.node.updateMany({
      where: { deletedRootId: sub },
      data: { deletedAt: null, deletedById: null, deletedRootId: null },
    });

    await trash(sub);
    await trash(folder);
    await ctx.prisma.node.update({ where: { id: sub }, data: { parentId: null } });
    await ctx.prisma.node.updateMany({
      where: { deletedRootId: sub },
      data: { deletedAt: null, deletedById: null, deletedRootId: null },
    });

    const rows = await ctx.prisma.node.findMany({
      where: { id: { in: [sub, leaf] } },
      select: { id: true, parentId: true, deletedAt: true },
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: sub, parentId: null, deletedAt: null },
        { id: leaf, parentId: sub, deletedAt: null },
      ]),
    );
    expect(await treeInvariants(ctx.prisma)).toEqual({
      liveUnderDeleted: 0,
      strandedInTrash: 0,
      badPaths: 0,
      cycles: 0,
    });
  });
});
