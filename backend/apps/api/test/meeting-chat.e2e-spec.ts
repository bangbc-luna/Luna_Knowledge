import request from 'supertest';
import { MeetingChatService } from '../src/meetings/meeting-chat.service.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Meeting chat (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let carol: LoggedIn;
  let outsider: LoggedIn;
  let wsId: string;
  const http = () => request(ctx.app.getHttpServer());
  const create = async (as: LoggedIn, body: Record<string, unknown> = {}) => {
    const res = await http()
      .post(`/api/v1/workspaces/${wsId}/meetings`)
      .set(as.auth)
      .send({ title: 'Chat', mode: 'instant', ...body })
      .expect(201);
    return res.body.id as string;
  };
  const live = async () => {
    const id = await create(alice);
    await http().post(`/api/v1/meetings/${id}/join`).set(alice.auth).expect(200);
    return id;
  };
  const send = (as: LoggedIn, id: string, body: unknown) =>
    http().post(`/api/v1/meetings/${id}/messages`).set(as.auth).send({ body });
  const list = (as: LoggedIn, id: string, query = '') =>
    http().get(`/api/v1/meetings/${id}/messages${query}`).set(as.auth);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    carol = await loginAs(ctx, 'carol@lunatech.vn', { name: 'Carol' });
    outsider = await loginAs(ctx, 'outsider@lunatech.vn', { name: 'Outsider' });
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .send({ name: 'Chat', slug: 'chat', kind: 'TEAM' })
      .expect(201);
    wsId = ws.body.id;
    await ctx.prisma.workspaceMember.createMany({
      data: [
        { workspaceId: wsId, userId: bob.userId, role: 'MEMBER' },
        { workspaceId: wsId, userId: carol.userId, role: 'MEMBER' },
      ],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('stores links and HTML verbatim, broadcasts luna.chat to the room and lists in order', async () => {
    const id = await live();
    ctx.media.broadcasts.length = 0;
    const first = '  see https://luna.test/a?x=1&y=2 <script>alert(1)</script> <b>hi</b>  ';
    const a = await send(bob, id, first).expect(201);
    expect(a.body).toMatchObject({
      body: first.trim(),
      author: { id: bob.userId, name: 'Bob' },
    });
    const b = await send(alice, id, 'second').expect(201);
    expect(JSON.parse(JSON.stringify(ctx.media.broadcasts))).toEqual([
      { roomName: `luna-${id}`, topic: 'luna.chat', payload: a.body },
      { roomName: `luna-${id}`, topic: 'luna.chat', payload: b.body },
    ]);
    const res = await list(carol, id).expect(200);
    expect(res.body.items.map((m: { body: string }) => m.body)).toEqual([first.trim(), 'second']);
    expect(res.body.items[0].createdAt).toBe(a.body.createdAt);
    expect(res.body.nextCursor).toBeNull();
    const row = await ctx.prisma.meetingChatMessage.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(row.body).toBe(first.trim());
    expect(
      await ctx.prisma.auditLog.count({ where: { targetId: id, action: { contains: 'chat' } } }),
    ).toBe(0);
  });

  it('paginates with a keyset cursor, including messages sharing a timestamp', async () => {
    const id = await live();
    const at = new Date();
    await ctx.prisma.meetingChatMessage.createMany({
      data: ['m1', 'm2', 'm3', 'm4', 'm5'].map((body) => ({
        meetingId: id,
        userId: bob.userId,
        body,
        createdAt: at,
      })),
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await list(
        alice,
        id,
        `?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      ).expect(200);
      seen.push(...res.body.items.map((m: { body: string }) => m.body));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect([...seen].sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(new Set(seen).size).toBe(5);
    await list(alice, id, '?cursor=garbage').expect(400);
    await list(alice, id, '?limit=201').expect(400);
  });

  it('rejects empty, blank, non-string and over-long bodies with 400', async () => {
    const id = await live();
    await send(bob, id, '').expect(400);
    await send(bob, id, '   ').expect(400);
    await send(bob, id, 42).expect(400);
    await send(bob, id, 'x'.repeat(2001)).expect(400);
    await send(bob, id, 'x'.repeat(2000)).expect(201);
  });

  it('only accepts messages while live, and history stays readable after the meeting ends', async () => {
    const scheduledId = await create(alice);
    const before = await send(bob, scheduledId, 'early').expect(409);
    expect(before.body.error.message).toBe('Chat is only open while the meeting is live');
    const id = await live();
    await send(bob, id, 'during').expect(201);
    await http().post(`/api/v1/meetings/${id}/end`).set(alice.auth).expect(204);
    await send(bob, id, 'late').expect(409);
    const res = await list(bob, id).expect(200);
    expect(res.body.items.map((m: { body: string }) => m.body)).toEqual(['during']);
    const cancelled = await create(alice, {
      mode: 'scheduled',
      scheduledAt: new Date(Date.now() + 7200_000).toISOString(),
    });
    await http().post(`/api/v1/meetings/${cancelled}/cancel`).set(alice.auth).expect(204);
    await send(bob, cancelled, 'x').expect(409);
  });

  it('hides chat from non-participants and from members removed mid-meeting', async () => {
    const id = await live();
    await send(carol, id, 'hello').expect(201);
    await send(outsider, id, 'hi').expect(404);
    await list(outsider, id).expect(404);
    await ctx.prisma.workspaceMember.deleteMany({
      where: { workspaceId: wsId, userId: carol.userId },
    });
    await send(carol, id, 'again').expect(404);
    await list(carol, id).expect(404);
    await ctx.prisma.workspaceMember.create({
      data: { workspaceId: wsId, userId: carol.userId, role: 'MEMBER' },
    });
    expect(await ctx.prisma.meetingChatMessage.count({ where: { meetingId: id } })).toBe(1);
  });

  it('invited guests outside the workspace can chat', async () => {
    const id = await create(alice, { inviteeEmails: ['outsider@lunatech.vn'] });
    await http().post(`/api/v1/meetings/${id}/join`).set(alice.auth).expect(200);
    await send(outsider, id, 'thanks for the invite').expect(201);
    await list(outsider, id).expect(200);
  });

  it('keeps the message and returns 201 when the broadcast fails', async () => {
    const id = await live();
    ctx.media.failNext('broadcast', new Error('livekit down'));
    const res = await send(bob, id, 'still saved').expect(201);
    const rows = await ctx.prisma.meetingChatMessage.findMany({ where: { meetingId: id } });
    expect(rows.map((r) => r.id)).toEqual([res.body.id]);
    const listed = await list(alice, id).expect(200);
    expect(listed.body.items.map((m: { id: string }) => m.id)).toEqual([res.body.id]);
  });

  it('requires authentication and a valid meeting id', async () => {
    const id = await live();
    await http().post(`/api/v1/meetings/${id}/messages`).send({ body: 'x' }).expect(401);
    await http().get(`/api/v1/meetings/${id}/messages`).expect(401);
    await send(bob, '00000000-0000-7000-8000-000000000000', 'x').expect(404);
    await send(bob, 'nope', 'x').expect(400);
  });

  it('timeline returns every message in order across internal batches', async () => {
    const id = await live();
    const base = Date.now();
    await ctx.prisma.meetingChatMessage.createMany({
      data: Array.from({ length: 1203 }, (_, i) => ({
        meetingId: id,
        userId: i % 2 ? bob.userId : alice.userId,
        body: `t${i}`,
        createdAt: new Date(base + Math.floor(i / 3)),
      })),
    });
    const service = ctx.app.get(MeetingChatService);
    const timeline = await service.timeline(id);
    expect(timeline).toHaveLength(1203);
    expect(new Set(timeline.map((m) => m.body)).size).toBe(1203);
    for (let i = 1; i < timeline.length; i += 1) {
      expect(timeline[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        timeline[i - 1]!.createdAt.getTime(),
      );
    }
    expect(Object.keys(timeline[0]!).sort()).toEqual(['body', 'createdAt', 'userId']);
    expect(await service.timeline('00000000-0000-7000-8000-000000000000')).toEqual([]);
  });
});
