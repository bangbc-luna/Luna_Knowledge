import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Server } from '@hocuspocus/server';
import { createPrismaClient, type PrismaClient } from '@luna/db';
import { emptyDoc, jsonToState, jsonToText, stateToJSON } from '@luna/editor';
import { COLLAB_ACCESS_CHANNEL, COLLAB_TOKEN_AUDIENCE } from '@luna/shared';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { SignJWT } from 'jose';
import { pino } from 'pino';
import * as Y from 'yjs';
import type { CollabConfig } from '../src/config.js';
import { createCollabServer } from '../src/server.js';

const SECRET = 'collab-e2e-token-secret-0123456789abcdef';
const INTERNAL = 'collab-e2e-internal-secret-0123456789ab';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Collab server (e2e)', () => {
  let pg: StartedPostgreSqlContainer;
  let redisC: StartedRedisContainer;
  let prisma: PrismaClient;
  let config: CollabConfig;
  let server: Server;
  let base: string;
  let workspaceId: string;
  let folderId: string;
  const users: Record<'editor' | 'editor2' | 'viewer' | 'outsider', string> = {} as never;
  const providers: HocuspocusProvider[] = [];

  const start = async () => {
    server = createCollabServer(config, pino({ level: 'silent' }), { prisma });
    await server.listen(0);
    base = `127.0.0.1:${server.address.port}`;
  };

  const token = (userId: string, nodeId: string, secret = SECRET) =>
    new SignJWT({ doc: nodeId, name: 'Tester' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setAudience(COLLAB_TOKEN_AUDIENCE)
      .setIssuer('luna-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));

  const newDocument = async (text = '') => {
    const json = text
      ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
      : emptyDoc();
    const node = await prisma.node.create({
      data: {
        workspaceId,
        parentId: folderId,
        type: 'DOCUMENT',
        name: `Doc ${Math.random()}`,
        nameNormalized: `doc ${Math.random()}`,
        createdById: users.editor,
        document: {
          create: {
            yjsState: new Uint8Array(jsonToState(json)),
            contentJson: json,
            contentText: text,
          },
        },
      },
    });
    return node.id;
  };

  const connect = async (userId: string, nodeId: string, tok?: string) => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://${base}`,
      name: `doc:${nodeId}`,
      token: tok ?? (await token(userId, nodeId)),
      document: ydoc,
    });
    providers.push(provider);
    const result = await new Promise<'synced' | string>((resolve) => {
      provider.on('synced', () => resolve('synced'));
      provider.on('authenticationFailed', ({ reason }: { reason: string }) => resolve(reason));
    });
    return { provider, ydoc, result };
  };

  const type = (ydoc: Y.Doc, text: string) =>
    ydoc.transact(() => {
      const para = new Y.XmlElement('paragraph');
      para.insert(0, [new Y.XmlText(text)]);
      ydoc.getXmlFragment('default').push([para]);
    });

  const textOf = (ydoc: Y.Doc) => jsonToText(stateToJSON(Y.encodeStateAsUpdate(ydoc)));

  const until = async (check: () => Promise<boolean> | boolean, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await sleep(200);
    }
    throw new Error('condition not met in time');
  };

  beforeAll(async () => {
    [pg, redisC] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: fileURLToPath(new URL('../../../packages/db', import.meta.url)),
      env: { ...process.env, DATABASE_URL: pg.getConnectionUri() },
      stdio: 'pipe',
    });
    prisma = createPrismaClient({ connectionString: pg.getConnectionUri(), max: 5 });
    for (const key of Object.keys({ editor: 1, editor2: 1, viewer: 1, outsider: 1 }) as Array<
      keyof typeof users
    >) {
      users[key] = (
        await prisma.user.create({ data: { email: `${key}@lunatech.vn`, name: key } })
      ).id;
    }
    const ws = await prisma.workspace.create({
      data: { name: 'Docs', slug: 'docs', createdById: users.editor },
    });
    workspaceId = ws.id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: users.editor, role: 'MEMBER' },
        { workspaceId, userId: users.editor2, role: 'MEMBER' },
      ],
    });
    folderId = (
      await prisma.node.create({
        data: {
          workspaceId,
          type: 'FOLDER',
          name: 'Docs',
          nameNormalized: 'docs',
          createdById: users.editor,
        },
      })
    ).id;
    await prisma.nodeShare.create({
      data: { nodeId: folderId, userId: users.viewer, role: 'VIEWER', grantedById: users.editor },
    });
    config = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent' as never,
      COLLAB_PORT: 0,
      DATABASE_URL: pg.getConnectionUri(),
      REDIS_URL: redisC.getConnectionUrl(),
      COLLAB_TOKEN_SECRET: SECRET,
      COLLAB_INTERNAL_SECRET: INTERNAL,
      COLLAB_AUTO_VERSION_MIN: 30,
    };
    await start();
  }, 180_000);

  afterEach(() => {
    providers.splice(0).forEach((p) => p.destroy());
  });

  afterAll(async () => {
    await server?.destroy();
    await prisma?.$disconnect();
    await Promise.all([pg?.stop(), redisC?.stop()]);
  });

  it('GET /health trả ok', async () => {
    const res = await fetch(`http://${base}/health`);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('từ chối token sai, token của tài liệu khác, người không có quyền', async () => {
    const nodeId = await newDocument();
    const other = await newDocument();
    expect((await connect(users.editor, nodeId, 'not-a-jwt')).result).not.toBe('synced');
    expect(
      (await connect(users.editor, nodeId, await token(users.editor, nodeId, 'x'.repeat(40))))
        .result,
    ).not.toBe('synced');
    expect((await connect(users.editor, nodeId, await token(users.editor, other))).result).not.toBe(
      'synced',
    );
    expect((await connect(users.outsider, nodeId)).result).not.toBe('synced');
    const noDoc = await new SignJWT({ name: 'Tester' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(users.editor)
      .setAudience(COLLAB_TOKEN_AUDIENCE)
      .setIssuer('luna-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    expect((await connect(users.editor, nodeId, noDoc)).result).not.toBe('synced');
    expect(
      (await connect(users.editor, folderId, await token(users.editor, folderId))).result,
    ).not.toBe('synced');
  });

  it('từ chối tài liệu đã vào thùng rác và tài khoản bị khoá', async () => {
    const trashed = await newDocument();
    await prisma.node.update({ where: { id: trashed }, data: { deletedAt: new Date() } });
    expect((await connect(users.editor, trashed)).result).not.toBe('synced');

    const nodeId = await newDocument();
    await prisma.user.update({ where: { id: users.editor2 }, data: { status: 'DISABLED' } });
    try {
      expect((await connect(users.editor2, nodeId)).result).not.toBe('synced');
    } finally {
      await prisma.user.update({ where: { id: users.editor2 }, data: { status: 'ACTIVE' } });
    }
    const nameless = await new SignJWT({ doc: nodeId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(users.editor2)
      .setAudience(COLLAB_TOKEN_AUDIENCE)
      .setIssuer('luna-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    expect((await connect(users.editor2, nodeId, nameless)).result).toBe('synced');
  });

  it('hai người cùng sửa đồng thời hội tụ cùng nội dung, lưu xuống DB', async () => {
    const nodeId = await newDocument();
    const a = await connect(users.editor, nodeId);
    const b = await connect(users.editor2, nodeId);
    for (let i = 0; i < 10; i++) type(i % 2 ? a.ydoc : b.ydoc, `Dòng ${i}`);
    await until(
      () => textOf(a.ydoc) === textOf(b.ydoc) && textOf(a.ydoc).split('\n').length === 10,
    );
    await until(
      async () => (await prisma.document.findUniqueOrThrow({ where: { nodeId } })).wordCount === 20,
    );
    const row = await prisma.document.findUniqueOrThrow({ where: { nodeId } });
    expect(row.contentText).toBe(textOf(a.ydoc));
    expect(row.lastEditedBy).toBeTruthy();
    expect(row.dirtySinceVersion).toBe(true);
  });

  it('VIEWER kết nối chỉ đọc: thay đổi không tới người khác, không vào DB', async () => {
    const nodeId = await newDocument('Nội dung gốc');
    const editor = await connect(users.editor, nodeId);
    const viewer = await connect(users.viewer, nodeId);
    expect(viewer.result).toBe('synced');
    type(viewer.ydoc, 'Người xem cố sửa');
    await sleep(3000);
    expect(textOf(editor.ydoc)).toBe('Nội dung gốc');
    expect((await prisma.document.findUniqueOrThrow({ where: { nodeId } })).contentText).toBe(
      'Nội dung gốc',
    );
  });

  it('khởi động lại collab server không mất dữ liệu', async () => {
    const nodeId = await newDocument();
    const a = await connect(users.editor, nodeId);
    type(a.ydoc, 'Trước khi khởi động lại');
    await until(
      async () =>
        (await prisma.document.findUniqueOrThrow({ where: { nodeId } })).contentText ===
        'Trước khi khởi động lại',
    );
    a.provider.destroy();
    await server.destroy();
    await start();
    const b = await connect(users.editor2, nodeId);
    expect(textOf(b.ydoc)).toBe('Trước khi khởi động lại');
  });

  it('thay nội dung (khôi phục) khi đang có người sửa: mọi client hội tụ về bản khôi phục', async () => {
    const nodeId = await newDocument('Bản cũ');
    const a = await connect(users.editor, nodeId);
    const b = await connect(users.editor2, nodeId);
    type(a.ydoc, 'Sửa thêm');
    await until(() => textOf(b.ydoc) === 'Bản cũ\nSửa thêm');
    const wrong = await fetch(`http://${base}/internal/documents/${nodeId}/replace`, {
      method: 'POST',
      headers: { 'x-internal-secret': 'wrong' },
      body: '{}',
    });
    expect(wrong.status).toBe(401);
    const res = await fetch(`http://${base}/internal/documents/${nodeId}/replace`, {
      method: 'POST',
      headers: { 'x-internal-secret': INTERNAL, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bản khôi phục' }] }],
        },
        actorId: users.editor,
        workspaceId,
      }),
    });
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: string };
    expect(jsonToText(stateToJSON(Buffer.from(state, 'base64')))).toBe('Bản khôi phục');
    await until(() => textOf(a.ydoc) === 'Bản khôi phục' && textOf(b.ydoc) === 'Bản khôi phục');
    type(b.ydoc, 'Gõ tiếp sau khôi phục');
    await until(() => textOf(a.ydoc) === 'Bản khôi phục\nGõ tiếp sau khôi phục');
  });

  it('thu hồi quyền giữa chừng: kết nối bị đóng', async () => {
    const temp = (await prisma.user.create({ data: { email: 'temp@lunatech.vn', name: 'temp' } }))
      .id;
    await prisma.workspaceMember.create({ data: { workspaceId, userId: temp, role: 'MEMBER' } });
    const nodeId = await newDocument();
    const t = await connect(temp, nodeId);
    expect(t.result).toBe('synced');
    const closed = new Promise<void>((resolve) => t.provider.on('close', () => resolve()));
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: temp } },
    });
    const pub = new Redis(config.REDIS_URL);
    await pub.publish(COLLAB_ACCESS_CHANNEL, JSON.stringify({ workspaceId, userId: temp }));
    await pub.quit();
    await closed;
  });

  it('phiên sửa kết thúc (không còn ai kết nối) thì tự tạo phiên bản', async () => {
    const nodeId = await newDocument();
    const a = await connect(users.editor, nodeId);
    type(a.ydoc, 'Nội dung phiên sửa');
    await until(
      async () =>
        (await prisma.document.findUniqueOrThrow({ where: { nodeId } })).contentText ===
        'Nội dung phiên sửa',
    );
    a.provider.destroy();
    await until(async () => (await prisma.documentVersion.count({ where: { nodeId } })) === 1);
    const v = await prisma.documentVersion.findFirstOrThrow({ where: { nodeId } });
    expect(v.isAuto).toBe(true);
    expect(v.contentText).toBe('Nội dung phiên sửa');
    expect((await prisma.document.findUniqueOrThrow({ where: { nodeId } })).dirtySinceVersion).toBe(
      false,
    );
  });

  it('người sửa đổi sang người khác: phiên bản tự động cho người trước, có ghi log số từ', async () => {
    const nodeId = await newDocument('Mở đầu');
    const a = await connect(users.editor, nodeId);
    type(a.ydoc, 'Phần của người thứ nhất');
    await until(
      async () =>
        (await prisma.document.findUniqueOrThrow({ where: { nodeId } })).lastEditedBy ===
        users.editor,
    );
    a.provider.destroy();
    await until(async () => (await prisma.documentVersion.count({ where: { nodeId } })) === 1);
    const b = await connect(users.editor2, nodeId);
    type(b.ydoc, 'Người thứ hai thêm đoạn này');
    await until(
      async () =>
        (await prisma.document.findUniqueOrThrow({ where: { nodeId } })).lastEditedBy ===
        users.editor2,
    );
    const c = await connect(users.editor, nodeId);
    type(c.ydoc, 'Người thứ nhất quay lại');
    await until(async () => (await prisma.documentVersion.count({ where: { nodeId } })) === 2);
    const v = await prisma.documentVersion.findFirstOrThrow({ where: { nodeId, versionNo: 2 } });
    expect(v.createdById).toBe(users.editor2);
    expect(v.wordsAdded).toBe(6);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'document.edit', targetId: nodeId, actorId: users.editor2 },
    });
    expect(log.metadata).toMatchObject({ versionNo: 2, wordsAdded: 6, wordsRemoved: 0 });
  });

  it('/metrics báo số tài liệu đang mở và số kết nối', async () => {
    const nodeId = await newDocument('Đo đếm');
    await connect(users.editor, nodeId);
    const res = await fetch(`http://${base}/metrics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/collab_documents_open\{service="collab"\} [1-9]/);
    expect(text).toMatch(/collab_connections\{service="collab"\} [1-9]/);
  });
});
