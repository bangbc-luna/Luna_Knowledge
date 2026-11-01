import { randomUUID } from 'node:crypto';
import type { MediaEvent } from '@luna/meetings';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { REDIS } from '../src/infra/redis/redis.token.js';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Meeting webhook (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let wsId: string;
  let redis: Redis;
  const http = () => request(ctx.app.getHttpServer());
  const create = async (as: LoggedIn) => {
    const res = await http()
      .post(`/api/v1/workspaces/${wsId}/meetings`)
      .set(as.auth)
      .send({ title: 'Room', mode: 'instant' })
      .expect(201);
    return res.body.id as string;
  };
  const room = (id: string) => `luna-${id}`;
  const send = (event: MediaEvent) => {
    const { body, authorization } = ctx.media.signWebhook(event);
    return http()
      .post('/api/v1/meetings/livekit/webhook')
      .set('Authorization', authorization)
      .set('Content-Type', 'application/webhook+json')
      .send(body);
  };
  const joined = (id: string, userId: string, at = new Date(), eventId = randomUUID()) =>
    send({ kind: 'participant_joined', roomName: room(id), identity: userId, eventId, at });
  const left = (id: string, userId: string, at = new Date(), eventId = randomUUID()) =>
    send({ kind: 'participant_left', roomName: room(id), identity: userId, eventId, at });
  const attendances = (meetingId: string) =>
    ctx.prisma.meetingAttendance.findMany({ where: { meetingId }, orderBy: { joinedAt: 'asc' } });

  beforeAll(async () => {
    ctx = await createTestApp();
    redis = ctx.app.get<Redis>(REDIS);
    await resetDatabase(ctx.prisma);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .send({ name: 'Hooks', slug: 'hooks', kind: 'TEAM' })
      .expect(201);
    wsId = ws.body.id;
    await ctx.prisma.workspaceMember.create({
      data: { workspaceId: wsId, userId: bob.userId, role: 'MEMBER' },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('webhook with a bad or missing signature returns 401 and changes nothing', async () => {
    const id = await create(alice);
    await http().post(`/api/v1/meetings/${id}/join`).set(alice.auth).expect(200);
    const { body } = ctx.media.signWebhook({
      kind: 'room_finished',
      roomName: room(id),
      eventId: randomUUID(),
      at: new Date(),
    });
    const bad = await http()
      .post('/api/v1/meetings/livekit/webhook')
      .set('Authorization', 'nope')
      .set('Content-Type', 'application/webhook+json')
      .send(body)
      .expect(401);
    expect(bad.body.error?.message ?? bad.body.message).toContain('Invalid webhook signature');
    await http()
      .post('/api/v1/meetings/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .send(body)
      .expect(401);
    const tampered = ctx.media.signWebhook({
      kind: 'room_finished',
      roomName: room(id),
      eventId: randomUUID(),
      at: new Date(),
    });
    await http()
      .post('/api/v1/meetings/livekit/webhook')
      .set('Authorization', tampered.authorization)
      .set('Content-Type', 'application/webhook+json')
      .send(tampered.body.replace('luna-', 'luna-0'))
      .expect(401);
    const row = await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('LIVE');
  });

  it('json routes keep parsing json bodies after the raw parser was added', async () => {
    await http()
      .post(`/api/v1/workspaces/${wsId}/meetings`)
      .set(alice.auth)
      .send({ title: 'Json still works', mode: 'instant' })
      .expect(201);
  });

  it('participant_joined then participant_left gives one attendance with joinedAt and leftAt', async () => {
    const id = await create(alice);
    const t0 = new Date(Date.now() - 5000);
    const t1 = new Date(Date.now() - 1000);
    await joined(id, bob.userId, t0).expect(200, { ok: true });
    let rows = await attendances(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.leftAt).toBeNull();
    await left(id, bob.userId, t1).expect(200, { ok: true });
    rows = await attendances(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.joinedAt.getTime()).toBe(t0.getTime());
    expect(rows[0]!.leftAt?.getTime()).toBe(t1.getTime());
    const row = await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SCHEDULED');
  });

  it('recorder identity and non user identities do not create attendance', async () => {
    const id = await create(alice);
    await joined(id, 'luna-recorder').expect(200);
    await joined(id, 'not-a-uuid').expect(200);
    expect(await attendances(id)).toHaveLength(0);
  });

  it('the same eventId sent twice is handled once', async () => {
    const id = await create(alice);
    const eventId = randomUUID();
    await joined(id, bob.userId, new Date(Date.now() - 3000), eventId).expect(200);
    await left(id, bob.userId, new Date(Date.now() - 2000)).expect(200);
    await joined(id, bob.userId, new Date(Date.now() - 1000), eventId).expect(200, { ok: true });
    const rows = await attendances(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.leftAt).not.toBeNull();
    expect(await redis.ttl(`meeting-webhook:${eventId}`)).toBeGreaterThan(0);
  });

  it('a failed handler releases the dedupe key so the retry is processed', async () => {
    const id = await create(alice);
    const eventId = randomUUID();
    const spy = vi
      .spyOn(ctx.prisma.meetingAttendance, 'create')
      .mockRejectedValueOnce(new Error('db down'));
    await joined(id, bob.userId, new Date(), eventId).expect(500);
    spy.mockRestore();
    expect(await redis.exists(`meeting-webhook:${eventId}`)).toBe(0);
    expect(await attendances(id)).toHaveLength(0);
    await joined(id, bob.userId, new Date(), eventId).expect(200);
    expect(await attendances(id)).toHaveLength(1);
  });

  it('participant_left arriving before participant_joined leaves no dangling open session', async () => {
    const id = await create(alice);
    const tJoin = new Date(Date.now() - 4000);
    const tLeft = new Date(Date.now() - 2000);
    await left(id, bob.userId, tLeft).expect(200);
    expect(await redis.get(`meeting-left:${id}:${bob.userId}`)).not.toBeNull();
    expect(await redis.ttl(`meeting-left:${id}:${bob.userId}`)).toBeLessThanOrEqual(60);
    await joined(id, bob.userId, tJoin).expect(200);
    const rows = await attendances(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.joinedAt.getTime()).toBe(tJoin.getTime());
    expect(rows[0]!.leftAt?.getTime()).toBe(tLeft.getTime());
    expect(await redis.exists(`meeting-left:${id}:${bob.userId}`)).toBe(0);
  });

  it('a stale left marker from before the join does not close a later session', async () => {
    const id = await create(alice);
    await left(id, bob.userId, new Date(Date.now() - 20_000)).expect(200);
    await joined(id, bob.userId, new Date(Date.now() - 1000)).expect(200);
    const rows = await attendances(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.leftAt).toBeNull();
  });

  it('room_finished ends a live meeting once and a repeat after the host ended writes no second audit', async () => {
    const id = await create(alice);
    await http().post(`/api/v1/meetings/${id}/join`).set(alice.auth).expect(200);
    await joined(id, bob.userId, new Date(Date.now() - 1000)).expect(200);
    await send({
      kind: 'room_finished',
      roomName: room(id),
      eventId: randomUUID(),
      at: new Date(),
    }).expect(200, { ok: true });
    const row = await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('ENDED');
    expect(row.endReason).toBe('room_finished');
    expect((await attendances(id)).every((a) => a.leftAt !== null)).toBe(true);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.end', targetId: id } }),
    ).toBe(1);
    await send({
      kind: 'room_finished',
      roomName: room(id),
      eventId: randomUUID(),
      at: new Date(),
    }).expect(200);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.end', targetId: id } }),
    ).toBe(1);
  });

  it('room_finished after the host ended writes no second audit', async () => {
    const id = await create(alice);
    await http().post(`/api/v1/meetings/${id}/join`).set(alice.auth).expect(200);
    await http().post(`/api/v1/meetings/${id}/end`).set(alice.auth).expect(204);
    const before = await ctx.prisma.auditLog.count({
      where: { action: 'meeting.end', targetId: id },
    });
    expect(before).toBe(1);
    await send({
      kind: 'room_finished',
      roomName: room(id),
      eventId: randomUUID(),
      at: new Date(),
    }).expect(200);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'meeting.end', targetId: id } }),
    ).toBe(1);
  });

  it('events for rooms outside Luna or unknown meetings return 200 and are ignored', async () => {
    await send({
      kind: 'room_finished',
      roomName: 'someone-elses-room',
      eventId: randomUUID(),
      at: new Date(),
    }).expect(200, { ok: true });
    await send({
      kind: 'room_finished',
      roomName: `luna-${randomUUID()}`,
      eventId: randomUUID(),
      at: new Date(),
    }).expect(200, { ok: true });
    await send({
      kind: 'room_started',
      roomName: `luna-${randomUUID()}`,
      eventId: randomUUID(),
      at: new Date(),
    }).expect(200, { ok: true });
  });
});
