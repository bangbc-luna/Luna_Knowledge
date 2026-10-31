import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  capRecentViews,
  createPrismaClient,
  type PrismaClient,
  purgeDeletedWorkspaces,
  purgeOldAuditLogs,
  purgeReadNotifications,
  RetentionError,
  TREE_LOCK_NAMESPACE,
  WorkspacePurgeError,
  runRetention,
  thinAutoVersions,
} from '@luna/db';
import { resetDatabase } from './create-test-app.js';

const DAY = 86_400_000;

describe('Retention (e2e, chạy bằng app role)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let userA: string;
  let userB: string;
  let liveWs: string;
  let seq = 0;

  const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
  const vnDate = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
  const vnAt = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
  const addDays = (date: string, days: number) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

  const makeNode = async (workspaceId: string, type: 'FOLDER' | 'DOCUMENT' | 'FILE' | 'VIDEO') => {
    const name = `n${++seq}`;
    return (
      await owner.node.create({
        data: { workspaceId, type, name, nameNormalized: name, createdById: userA },
      })
    ).id;
  };

  const makeVersion = (
    nodeId: string,
    versionNo: number,
    createdAt: Date,
    isAuto: boolean,
    restoredFromId?: string,
  ) =>
    owner.documentVersion.create({
      data: {
        nodeId,
        versionNo,
        isAuto,
        createdAt,
        restoredFromId,
        yjsSnapshot: Buffer.from([1]),
        contentJson: {},
        contentText: `v${versionNo}`,
      },
    });

  const makeBlob = (nodeId: string, kind: 'ORIGINAL' | 'HLS', key: string) =>
    owner.blob.create({
      data: {
        nodeId,
        kind,
        provider: 'S3',
        container: 'e2e-originals',
        key,
        sizeBytes: 1n,
        mime: 'application/octet-stream',
      },
    });

  beforeAll(async () => {
    owner = createPrismaClient({ connectionString: process.env.DATABASE_URL!, max: 2 });
    app = createPrismaClient({ connectionString: process.env.DATABASE_APP_URL!, max: 2 });
    await resetDatabase(owner);
    userA = (await owner.user.create({ data: { email: 'ra@lunatech.vn', name: 'A' } })).id;
    userB = (await owner.user.create({ data: { email: 'rb@lunatech.vn', name: 'B' } })).id;
    liveWs = (
      await owner.workspace.create({ data: { name: 'Live', slug: 'live', createdById: userA } })
    ).id;
  });

  afterAll(async () => {
    await app?.$disconnect();
    await owner?.$disconnect();
  });

  it('app role đúng là login không phải owner', async () => {
    const [row] = await app.$queryRaw<Array<{ me: string }>>`SELECT current_user AS me`;
    expect(row!.me).toBe('luna_app_e2e');
  });

  it('audit log quá 1 năm bị xoá theo lô, bản ghi 300 ngày giữ nguyên', async () => {
    await owner.$executeRaw`
      INSERT INTO audit_logs (action, target_id, created_at) VALUES
        ('ret.audit', 'old1', now() - interval '400 days'),
        ('ret.audit', 'old2', now() - interval '500 days'),
        ('ret.audit', 'old3', now() - interval '366 days'),
        ('ret.audit', 'young', now() - interval '300 days'),
        ('ret.audit', 'new', now())`;
    expect(await purgeOldAuditLogs(app, { batchSize: 2 })).toBe(3);
    const left = await owner.auditLog.findMany({
      where: { action: 'ret.audit' },
      orderBy: { targetId: 'asc' },
      select: { targetId: true },
    });
    expect(left.map((r) => r.targetId)).toEqual(['new', 'young']);
  });

  it('thông báo đã đọc quá 90 ngày bị xoá; chưa đọc thì giữ dù cũ', async () => {
    const make = (userId: string, tag: string, createdAt: Date, readAt: Date | null) =>
      owner.notification.create({
        data: { userId, type: 'ret.test', payload: { tag }, createdAt, readAt },
      });
    await make(userA, 'read-100', daysAgo(120), daysAgo(100));
    await make(userB, 'read-95', daysAgo(95), daysAgo(95));
    await make(userA, 'read-91', daysAgo(200), daysAgo(91));
    await make(userA, 'read-80', daysAgo(200), daysAgo(80));
    await make(userA, 'unread-old', daysAgo(400), null);
    await make(userB, 'read-new', daysAgo(1), daysAgo(1));
    expect(await purgeReadNotifications(app, { batchSize: 2 })).toBe(3);
    const left = await owner.notification.findMany({ where: { type: 'ret.test' } });
    expect(left.map((n) => (n.payload as { tag: string }).tag).sort()).toEqual([
      'read-80',
      'read-new',
      'unread-old',
    ]);
  });

  it('mở gần đây giữ 50 mục mới nhất mỗi người', async () => {
    const nodes: string[] = [];
    for (let i = 0; i < 55; i++) nodes.push(await makeNode(liveWs, 'FOLDER'));
    await owner.recentView.createMany({
      data: [
        ...nodes.map((nodeId, i) => ({
          userId: userA,
          nodeId,
          viewedAt: new Date(Date.now() - (i + 1) * 60_000),
        })),
        ...nodes.slice(0, 10).map((nodeId, i) => ({
          userId: userB,
          nodeId,
          viewedAt: daysAgo(500 + i),
        })),
      ],
    });
    expect(await capRecentViews(app, { batchSize: 2 })).toBe(5);
    const a = await owner.recentView.findMany({
      where: { userId: userA },
      orderBy: { viewedAt: 'desc' },
    });
    expect(a.map((r) => r.nodeId)).toEqual(nodes.slice(0, 50));
    expect(await owner.recentView.count({ where: { userId: userB } })).toBe(10);
  });

  it('phiên bản tự lưu quá 30 ngày chỉ giữ bản cuối mỗi ngày theo giờ Việt Nam; bản lưu tay và bản trong 30 ngày giữ nguyên', async () => {
    const doc = await makeNode(liveWs, 'DOCUMENT');
    const other = await makeNode(liveWs, 'DOCUMENT');
    const d = vnDate(daysAgo(40));
    const auto0800 = await makeVersion(doc, 1, vnAt(d, '08:00'), true);
    const manual0900 = await makeVersion(doc, 2, vnAt(d, '09:00'), false);
    const auto2000 = await makeVersion(doc, 3, vnAt(d, '20:00'), true);
    const auto2330 = await makeVersion(doc, 4, vnAt(d, '23:30'), true);
    const auto0030 = await makeVersion(doc, 5, vnAt(addDays(d, 1), '00:30'), true);
    const recentA = await makeVersion(doc, 6, daysAgo(10), true);
    const recentB = await makeVersion(doc, 7, new Date(daysAgo(10).getTime() + 60_000), true);
    const otherOld = await makeVersion(other, 1, vnAt(d, '08:00'), true);
    expect(auto2330.createdAt.toISOString()).toBe(`${d}T16:30:00.000Z`);
    expect(auto0030.createdAt.toISOString()).toBe(`${d}T17:30:00.000Z`);

    expect(await thinAutoVersions(app, { olderThanDays: 30, batchSize: 1 })).toBe(2);

    const left = await owner.documentVersion.findMany({
      where: { nodeId: { in: [doc, other] } },
      select: { id: true },
    });
    expect(left.map((v) => v.id).sort()).toEqual(
      [manual0900, auto2330, auto0030, recentA, recentB, otherOld].map((v) => v.id).sort(),
    );
    expect(
      await owner.documentVersion.count({ where: { id: { in: [auto0800.id, auto2000.id] } } }),
    ).toBe(0);
  });

  it('phiên bản được khôi phục từ bản bị dọn: restored_from_id về NULL', async () => {
    const doc = await makeNode(liveWs, 'DOCUMENT');
    const d = vnDate(daysAgo(50));
    const early = await makeVersion(doc, 1, vnAt(d, '09:00'), true);
    const late = await makeVersion(doc, 2, vnAt(d, '18:00'), true);
    const restored = await makeVersion(doc, 3, daysAgo(2), false, early.id);
    const restoredKept = await makeVersion(doc, 4, daysAgo(1), false, late.id);

    expect(await thinAutoVersions(app, { olderThanDays: 30 })).toBe(1);

    const rows = await owner.documentVersion.findMany({
      where: { nodeId: doc },
      orderBy: { versionNo: 'asc' },
      select: { id: true, restoredFromId: true },
    });
    expect(rows).toEqual([
      { id: late.id, restoredFromId: null },
      { id: restored.id, restoredFromId: null },
      { id: restoredKept.id, restoredFromId: late.id },
    ]);
  });

  it('workspace xoá mềm quá 30 ngày bị xoá hẳn kèm node, blob vào blob_gc; workspace xoá 10 ngày giữ nguyên', async () => {
    const seedWorkspace = async (slug: string, deletedAt: Date | null) => {
      const ws = (
        await owner.workspace.create({
          data: { name: slug, slug, createdById: userA, deletedAt },
        })
      ).id;
      const folder = await makeNode(ws, 'FOLDER');
      const nameChild = `c${++seq}`;
      const trashedId = randomUUID();
      await owner.node.create({
        data: {
          id: trashedId,
          workspaceId: ws,
          parentId: folder,
          type: 'FOLDER',
          name: nameChild,
          nameNormalized: nameChild,
          createdById: userA,
          deletedAt: daysAgo(5),
          deletedRootId: trashedId,
        },
      });
      const video = await makeNode(ws, 'VIDEO');
      const original = await makeBlob(video, 'ORIGINAL', `${slug}/original`);
      const hls = await makeBlob(video, 'HLS', `${slug}/hls`);
      const version = await owner.fileVersion.create({
        data: {
          nodeId: video,
          versionNo: 1,
          fileName: 'v.mp4',
          originalBlobId: original.id,
          uploadedById: userA,
        },
      });
      await owner.fileInfo.create({ data: { nodeId: video, currentVersionId: version.id } });
      await owner.video.create({
        data: {
          nodeId: video,
          versionId: version.id,
          durationSec: 1,
          width: 1,
          height: 1,
          renditions: [],
          hlsBlobId: hls.id,
          keyEncrypted: Buffer.from([1]),
        },
      });
      const doc = await makeNode(ws, 'DOCUMENT');
      const v1 = await makeVersion(doc, 1, daysAgo(3), true);
      await makeVersion(doc, 2, daysAgo(2), false, v1.id);
      await owner.recentView.create({ data: { userId: userB, nodeId: doc } });
      await owner.workspaceMember.create({
        data: { workspaceId: ws, userId: userB, role: 'MEMBER' },
      });
      return ws;
    };
    const old = await seedWorkspace('ret-old', daysAgo(40));
    const old2 = await seedWorkspace('ret-old2', daysAgo(31));
    const young = await seedWorkspace('ret-young', daysAgo(10));
    const live = await seedWorkspace('ret-live', null);
    await owner.blobGc.deleteMany();

    expect(await purgeDeletedWorkspaces(app, { olderThanDays: 30 })).toBe(2);

    const workspaces = await owner.workspace.findMany({
      where: { id: { in: [old, old2, young, live] } },
      select: { id: true },
    });
    expect(workspaces.map((w) => w.id).sort()).toEqual([young, live].sort());
    expect(await owner.node.count({ where: { workspaceId: { in: [old, old2] } } })).toBe(0);
    expect(await owner.workspaceMember.count({ where: { workspaceId: { in: [old, old2] } } })).toBe(
      0,
    );
    for (const ws of [young, live]) {
      expect(await owner.node.count({ where: { workspaceId: ws } })).toBe(4);
      expect(await owner.blob.count({ where: { node: { workspaceId: ws } } })).toBe(2);
      expect(await owner.video.count({ where: { node: { workspaceId: ws } } })).toBe(1);
      expect(await owner.documentVersion.count({ where: { node: { workspaceId: ws } } })).toBe(2);
    }
    const gc = await owner.blobGc.findMany({ select: { key: true } });
    expect(gc.map((g) => g.key).sort()).toEqual([
      'ret-old/hls',
      'ret-old/original',
      'ret-old2/hls',
      'ret-old2/original',
    ]);
  });

  it('workspace công ty xoá mềm quá hạn không bao giờ bị xoá hẳn', async () => {
    const company = (
      await owner.workspace.create({
        data: {
          name: 'Company',
          slug: 'ret-company',
          kind: 'COMPANY',
          createdById: userA,
          deletedAt: daysAgo(400),
        },
      })
    ).id;
    await makeNode(company, 'FOLDER');
    expect(await purgeDeletedWorkspaces(app, { olderThanDays: 30 })).toBe(0);
    expect(await owner.workspace.count({ where: { id: company } })).toBe(1);
    expect(await owner.node.count({ where: { workspaceId: company } })).toBe(1);
  });

  it('một workspace dọn lỗi không chặn các workspace sau; lỗi được báo lại', async () => {
    const seed = async (slug: string, deletedAt: Date) => {
      const ws = (
        await owner.workspace.create({ data: { name: slug, slug, createdById: userA, deletedAt } })
      ).id;
      await makeNode(ws, 'FOLDER');
      return ws;
    };
    const stuck = await seed('ret-stuck', daysAgo(60));
    const next = await seed('ret-next', daysAgo(45));
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL! });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [
        TREE_LOCK_NAMESPACE,
        stuck,
      ]);
      const reported: Array<{ step: string; workspaceId?: string }> = [];
      const err = await purgeDeletedWorkspaces(app, {
        olderThanDays: 30,
        lockTimeoutMs: 200,
        onError: (_e, context) => reported.push(context),
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkspacePurgeError);
      expect((err as WorkspacePurgeError).purged).toBe(1);
      expect((err as WorkspacePurgeError).failedWorkspaceIds).toEqual([stuck]);
      expect(reported).toEqual([{ step: 'workspaces', workspaceId: stuck }]);
      expect(await owner.workspace.count({ where: { id: next } })).toBe(0);
      expect(await owner.workspace.count({ where: { id: stuck } })).toBe(1);
      expect(await owner.node.count({ where: { workspaceId: stuck } })).toBe(1);
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
    expect(await purgeDeletedWorkspaces(app, { olderThanDays: 30 })).toBe(1);
    expect(await owner.workspace.count({ where: { id: stuck } })).toBe(0);
  });

  it('runRetention: bước lỗi không chặn các bước sau, kết quả từng phần nằm trong lỗi', async () => {
    await owner.notification.create({
      data: {
        userId: userA,
        type: 'ret.partial',
        payload: {},
        createdAt: daysAgo(200),
        readAt: daysAgo(100),
      },
    });
    const gone = (
      await owner.workspace.create({
        data: { name: 'p', slug: 'ret-partial', createdById: userA, deletedAt: daysAgo(40) },
      })
    ).id;
    await owner.$executeRawUnsafe(
      'REVOKE EXECUTE ON FUNCTION purge_audit_logs(integer) FROM luna_app',
    );
    const reported: string[] = [];
    try {
      const err = await runRetention(app, {
        workspacePurgeDays: 30,
        autoVersionThinDays: 30,
        onError: (_e, context) => reported.push(context.step),
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RetentionError);
      expect((err as RetentionError).failedSteps).toEqual(['auditLogs']);
      expect((err as RetentionError).result).toEqual(
        expect.objectContaining({ auditLogs: 0, notifications: 1, workspaces: 1 }),
      );
      expect(reported).toEqual(['auditLogs']);
      expect(await owner.workspace.count({ where: { id: gone } })).toBe(0);
    } finally {
      await owner.$executeRawUnsafe(
        'GRANT EXECUTE ON FUNCTION purge_audit_logs(integer) TO luna_app',
      );
    }
  });

  it('chạy lại lần hai không xoá thêm gì', async () => {
    await owner.$executeRaw`
      INSERT INTO audit_logs (action, target_id, created_at)
      VALUES ('ret.rerun', 'old', now() - interval '400 days')`;
    const first = await runRetention(app, { workspacePurgeDays: 30, autoVersionThinDays: 30 });
    expect(first.auditLogs).toBe(1);
    expect(await runRetention(app, { workspacePurgeDays: 30, autoVersionThinDays: 30 })).toEqual({
      auditLogs: 0,
      notifications: 0,
      recentViews: 0,
      documentVersions: 0,
      workspaces: 0,
    });
    expect(await owner.workspace.count({ where: { slug: 'ret-young' } })).toBe(1);
    expect(await owner.workspace.count({ where: { id: liveWs } })).toBe(1);
  });
});
