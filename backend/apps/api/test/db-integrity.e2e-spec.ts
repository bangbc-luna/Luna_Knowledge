import { randomUUID } from 'node:crypto';
import { createTestApp, resetDatabase, type TestContext } from './create-test-app.js';

describe('Database integrity (e2e)', () => {
  let ctx: TestContext;
  let userId: string;
  let wsId: string;
  let seq = 0;

  const createNode = async (type: 'VIDEO' | 'DOCUMENT') => {
    seq += 1;
    return ctx.prisma.node.create({
      data: {
        workspaceId: wsId,
        type,
        section: type === 'VIDEO' ? 'VIDEOS' : 'DOCS',
        name: `n${seq}`,
        nameNormalized: `n${seq}`,
        createdById: userId,
      },
    });
  };

  const createBlob = (
    nodeId: string,
    kind: 'ORIGINAL' | 'HLS' | 'POSTER' | 'SPRITE',
    key?: string,
  ) =>
    ctx.prisma.blob.create({
      data: {
        nodeId,
        kind,
        provider: 'S3',
        container: 'bucket',
        key: key ?? randomUUID(),
        sizeBytes: 1n,
        mime: 'application/octet-stream',
      },
    });

  const createVideoGraph = async () => {
    const node = await createNode('VIDEO');
    const original = await createBlob(node.id, 'ORIGINAL');
    const version = await ctx.prisma.fileVersion.create({
      data: {
        nodeId: node.id,
        versionNo: 1,
        fileName: 'v.mp4',
        originalBlobId: original.id,
        uploadedById: userId,
      },
    });
    const hls = await createBlob(node.id, 'HLS');
    const poster = await createBlob(node.id, 'POSTER');
    const sprite = await createBlob(node.id, 'SPRITE');
    await ctx.prisma.video.create({
      data: {
        nodeId: node.id,
        versionId: version.id,
        durationSec: 1,
        width: 1,
        height: 1,
        renditions: [],
        hlsBlobId: hls.id,
        posterBlobId: poster.id,
        spriteBlobId: sprite.id,
        keyEncrypted: new Uint8Array([1]),
      },
    });
    return { node, original, version, hls, poster, sprite };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const user = await ctx.prisma.user.create({
      data: { email: 'integrity@lunatech.vn', name: 'Integrity' },
    });
    userId = user.id;
    const ws = await ctx.prisma.workspace.create({
      data: { name: 'Integrity', slug: 'integrity', createdById: userId },
    });
    wsId = ws.id;
  });

  afterAll(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.close();
  });

  it('không tạo được hai blob cùng provider, container, key', async () => {
    const node = await createNode('VIDEO');
    await createBlob(node.id, 'ORIGINAL', 'same-key');
    await expect(createBlob(node.id, 'ORIGINAL', 'same-key')).rejects.toThrow(
      /blobs_provider_container_key_key|Unique/,
    );
  });

  it('xoá phiên bản tài liệu từng được khôi phục: restored_from_id về NULL', async () => {
    const node = await createNode('DOCUMENT');
    const make = (versionNo: number, restoredFromId?: string) =>
      ctx.prisma.documentVersion.create({
        data: {
          nodeId: node.id,
          versionNo,
          restoredFromId,
          yjsSnapshot: new Uint8Array([1]),
          contentJson: {},
          contentText: '',
        },
      });
    const source = await make(1);
    const restored = await make(2, source.id);
    await ctx.prisma.documentVersion.delete({ where: { id: source.id } });
    const after = await ctx.prisma.documentVersion.findUniqueOrThrow({
      where: { id: restored.id },
    });
    expect(after.restoredFromId).toBeNull();
  });

  it('xoá blob đang làm poster: poster_blob_id về NULL', async () => {
    const g = await createVideoGraph();
    await ctx.prisma.blob.delete({ where: { id: g.poster.id } });
    const video = await ctx.prisma.video.findUniqueOrThrow({ where: { nodeId: g.node.id } });
    expect(video.posterBlobId).toBeNull();
    expect(video.spriteBlobId).toBe(g.sprite.id);
  });

  it('không xoá được blob HLS khi video còn trỏ tới', async () => {
    const g = await createVideoGraph();
    await expect(ctx.prisma.blob.delete({ where: { id: g.hls.id } })).rejects.toThrow();
  });

  it('xoá node video xoá được cả video, phiên bản và blob trong một lệnh', async () => {
    const g = await createVideoGraph();
    await ctx.prisma.node.delete({ where: { id: g.node.id } });
    expect(await ctx.prisma.blob.count({ where: { nodeId: g.node.id } })).toBe(0);
    expect(await ctx.prisma.video.count({ where: { nodeId: g.node.id } })).toBe(0);
    expect(await ctx.prisma.fileVersion.count({ where: { nodeId: g.node.id } })).toBe(0);
  });

  it('documents.last_edited_by trỏ tới user không tồn tại bị chặn', async () => {
    const node = await createNode('DOCUMENT');
    await expect(
      ctx.prisma.document.create({ data: { nodeId: node.id, lastEditedBy: randomUUID() } }),
    ).rejects.toThrow();
  });

  it('xoá user làm last_edited_by về NULL', async () => {
    const editor = await ctx.prisma.user.create({
      data: { email: 'editor-int@lunatech.vn', name: 'E' },
    });
    const node = await createNode('DOCUMENT');
    await ctx.prisma.document.create({ data: { nodeId: node.id, lastEditedBy: editor.id } });
    await ctx.prisma.user.delete({ where: { id: editor.id } });
    const doc = await ctx.prisma.document.findUniqueOrThrow({ where: { nodeId: node.id } });
    expect(doc.lastEditedBy).toBeNull();
  });
});
