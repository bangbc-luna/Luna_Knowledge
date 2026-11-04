import { createDocumentVersion } from '@luna/db';
import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Lưu phiên bản tài liệu và xoá node không deadlock (e2e)', () => {
  let ctx: TestContext;
  let owner: LoggedIn;
  let wsId: string;
  const http = () => request(ctx.app.getHttpServer());
  const waitForLockWait = async () => {
    for (let i = 0; i < 200; i++) {
      const rows = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE '%FOR KEY SHARE%'`;
      if (Number(rows[0]?.n ?? 0) > 0) return;
      await sleep(25);
    }
    throw new Error('Lưu phiên bản không bị chặn bởi khoá node');
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await loginAs(ctx, 'owner@lunatech.vn', { name: 'Chủ' });
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(owner.auth)
      .send({ name: 'Khoá', slug: 'khoa' })
      .expect(201);
    wsId = ws.body.id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('một giao dịch giữ khoá node trước rồi mới đụng documents thì lưu phiên bản chờ, không deadlock', async () => {
    const nodeId = (
      await http()
        .post(`/api/v1/workspaces/${wsId}/documents`)
        .set(owner.auth)
        .send({ name: 'Đua khoá' })
        .expect(201)
    ).body.node.id as string;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const nodeLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const deleter = ctx.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM nodes WHERE id = ${nodeId}::uuid FOR UPDATE`;
        locked();
        await gate;
        await tx.$executeRaw`UPDATE documents SET dirty_since_version = dirty_since_version WHERE node_id = ${nodeId}::uuid`;
      },
      { timeout: 15000 },
    );
    await nodeLocked;
    const version = createDocumentVersion(ctx.prisma, {
      nodeId,
      yjsSnapshot: new Uint8Array([0]),
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      contentText: '',
      wordCount: 0,
    });
    await waitForLockWait();
    release();
    const results = await Promise.allSettled([deleter, version]);
    const messages = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String((r.reason as Error)?.message ?? r.reason));
    expect(messages.filter((m) => /deadlock/i.test(m))).toEqual([]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  });
});
