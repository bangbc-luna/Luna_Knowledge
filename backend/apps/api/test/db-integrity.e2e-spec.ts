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

  const createThread = async () => {
    const node = await createNode('DOCUMENT');
    return ctx.prisma.commentThread.create({
      data: { nodeId: node.id, quotedText: 'q', createdById: userId },
    });
  };

  it('comments.mentions không nhận NULL', async () => {
    const thread = await createThread();
    const comment = await ctx.prisma.comment.create({
      data: { threadId: thread.id, authorId: userId, body: 'b' },
    });
    await expect(
      ctx.prisma.$executeRaw`UPDATE comments SET mentions = NULL WHERE id = ${comment.id}::uuid`,
    ).rejects.toThrow();
  });

  it('thread RESOLVED phải có resolved_at, OPEN thì không', async () => {
    const thread = await createThread();
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE comment_threads SET status = 'RESOLVED' WHERE id = ${thread.id}::uuid`,
    ).rejects.toThrow(/comment_threads_resolved_consistent/);
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE comment_threads SET resolved_at = now() WHERE id = ${thread.id}::uuid`,
    ).rejects.toThrow(/comment_threads_resolved_consistent/);
    await ctx.prisma.commentThread.update({
      where: { id: thread.id },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: userId },
    });
  });

  it('vị trí xem âm và kích thước âm bị chặn', async () => {
    const g = await createVideoGraph();
    await expect(
      ctx.prisma.videoWatch.create({
        data: { userId, nodeId: g.node.id, positionSec: -3 },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.blob.update({ where: { id: g.original.id }, data: { sizeBytes: -1n } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.fileVersion.update({ where: { id: g.version.id }, data: { versionNo: 0 } }),
    ).rejects.toThrow();
  });

  it('nodes.path không nhận NULL', async () => {
    const node = await createNode('DOCUMENT');
    await expect(
      ctx.prisma.$executeRaw`UPDATE nodes SET path = NULL WHERE id = ${node.id}::uuid`,
    ).rejects.toThrow(/nodes_path_present/);
  });

  it('deleted_at và deleted_root_id luôn đi cùng nhau', async () => {
    const node = await createNode('DOCUMENT');
    await expect(
      ctx.prisma.$executeRaw`UPDATE nodes SET deleted_at = now() WHERE id = ${node.id}::uuid`,
    ).rejects.toThrow(/nodes_trash_consistent/);
    await expect(
      ctx.prisma.$executeRaw`UPDATE nodes SET deleted_root_id = id WHERE id = ${node.id}::uuid`,
    ).rejects.toThrow(/nodes_trash_consistent/);
  });

  it('meetings: CHECK chặn tiêu đề rỗng, kết thúc trước khi bắt đầu, lịch thiếu giờ, chat quá 2000 ký tự', async () => {
    const make = (data: Record<string, unknown>) =>
      ctx.prisma.meeting.create({
        data: {
          workspaceId: wsId,
          createdById: userId,
          title: 'Họp',
          status: 'LIVE',
          ...data,
        } as never,
      });
    await expect(make({ title: '' })).rejects.toThrow(/meetings_title_len/);
    await expect(make({ title: 'x'.repeat(201) })).rejects.toThrow(/meetings_title_len/);
    await expect(
      make({
        startedAt: new Date('2026-11-01T10:00:00Z'),
        endedAt: new Date('2026-11-01T09:00:00Z'),
      }),
    ).rejects.toThrow(/meetings_ended_after_started/);
    await expect(make({ status: 'SCHEDULED', scheduledAt: null })).rejects.toThrow(
      /meetings_scheduled_has_time/,
    );
    const ok = await make({});
    await expect(
      ctx.prisma.meetingChatMessage.create({
        data: { meetingId: ok.id, userId, body: 'x'.repeat(2001) },
      }),
    ).rejects.toThrow(/meeting_chat_body_len/);
    await expect(
      ctx.prisma.meetingChatMessage.create({ data: { meetingId: ok.id, userId, body: '' } }),
    ).rejects.toThrow(/meeting_chat_body_len/);
    await expect(
      ctx.prisma.meetingAttendance.create({
        data: {
          meetingId: ok.id,
          userId,
          joinedAt: new Date('2026-11-01T10:00:00Z'),
          leftAt: new Date('2026-11-01T09:00:00Z'),
        },
      }),
    ).rejects.toThrow(/meeting_attendances_left_after_join/);
  });

  it('meeting_attendances: mỗi người chỉ một phiên mở trong một buổi họp', async () => {
    const meeting = await ctx.prisma.meeting.create({
      data: { workspaceId: wsId, createdById: userId, title: 'Một phiên', status: 'LIVE' },
    });
    const open = () =>
      ctx.prisma.meetingAttendance.create({
        data: { meetingId: meeting.id, userId, joinedAt: new Date() },
      });
    await open();
    await expect(open()).rejects.toThrow(/meeting_attendances_one_open|Unique/);
    await ctx.prisma.meetingAttendance.updateMany({
      where: { meetingId: meeting.id },
      data: { leftAt: new Date(Date.now() + 1000) },
    });
    await open();
  });
});
