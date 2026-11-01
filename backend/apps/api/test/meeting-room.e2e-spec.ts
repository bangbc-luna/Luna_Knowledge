import request from 'supertest';
import {
  createTestApp,
  type LoggedIn,
  loginAs,
  resetDatabase,
  type TestContext,
} from './create-test-app.js';

describe('Meeting rooms (e2e)', () => {
  let ctx: TestContext;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let carol: LoggedIn;
  let guest: LoggedIn;
  let wsId: string;
  const http = () => request(ctx.app.getHttpServer());
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const create = async (as: LoggedIn, body: Record<string, unknown> = {}) => {
    const res = await http()
      .post(`/api/v1/workspaces/${wsId}/meetings`)
      .set(as.auth)
      .send({ title: 'Room', mode: 'instant', ...body })
      .expect(201);
    return res.body.id as string;
  };
  const join = (as: LoggedIn, id: string) =>
    http().post(`/api/v1/meetings/${id}/join`).set(as.auth);
  const countAudit = (action: string, targetId: string) =>
    ctx.prisma.auditLog.count({ where: { action, targetId } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    alice = await loginAs(ctx, 'alice@lunatech.vn', { name: 'Alice' });
    bob = await loginAs(ctx, 'bob@lunatech.vn', { name: 'Bob' });
    carol = await loginAs(ctx, 'carol@lunatech.vn', { name: 'Carol' });
    guest = await loginAs(ctx, 'guest@lunatech.vn', { name: 'Guest' });
    const ws = await http()
      .post('/api/v1/workspaces')
      .set(alice.auth)
      .send({ name: 'Rooms', slug: 'rooms', kind: 'TEAM' })
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

  it('first join moves SCHEDULED to LIVE, sets startedAt, audits meeting.start and creates the room with metadata', async () => {
    const id = await create(alice, { aiNotesEnabled: false });
    const res = await join(alice, id).expect(200);
    expect(res.body).toMatchObject({
      serverUrl: ctx.media.serverUrl,
      roomName: `luna-${id}`,
      identity: alice.userId,
      aiNotesEnabled: false,
      isHost: true,
      expiresInSec: 600,
    });
    expect(typeof res.body.token).toBe('string');
    const row = await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('LIVE');
    expect(row.startedAt).not.toBeNull();
    expect(await countAudit('meeting.start', id)).toBe(1);
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata)).toEqual({
      title: 'Room',
      aiNotesEnabled: false,
      hostId: alice.userId,
    });
    await join(bob, id).expect(200);
    expect(await countAudit('meeting.start', id)).toBe(1);
  });

  it('two simultaneous joins start the meeting only once', async () => {
    const id = await create(alice);
    await Promise.all([join(alice, id), join(bob, id)]);
    expect(await countAudit('meeting.start', id)).toBe(1);
  });

  it('token identity is the user id, host role for the creator, participant for others, invitees outside the workspace can join', async () => {
    const id = await create(alice, { inviteeEmails: ['guest@lunatech.vn'] });
    ctx.media.tokens.length = 0;
    await join(alice, id).expect(200);
    await join(bob, id).expect(200);
    const res = await join(guest, id).expect(200);
    expect(res.body.isHost).toBe(false);
    expect(ctx.media.tokens.map((t) => [t.identity, t.role])).toEqual([
      [alice.userId, 'host'],
      [bob.userId, 'participant'],
      [guest.userId, 'participant'],
    ]);
    expect(ctx.media.tokens[2]?.name).toBe('Guest');
    await join(carol, id).expect(200);
    await http()
      .post(`/api/v1/meetings/${await create(alice)}/join`)
      .set(guest.auth)
      .expect(404);
  });

  it('a member removed from the workspace after the meeting started gets 404 on join', async () => {
    const id = await create(alice);
    await join(alice, id).expect(200);
    await ctx.prisma.workspaceMember.deleteMany({
      where: { workspaceId: wsId, userId: carol.userId },
    });
    await join(carol, id).expect(404);
    await ctx.prisma.workspaceMember.create({
      data: { workspaceId: wsId, userId: carol.userId, role: 'MEMBER' },
    });
  });

  it('ended or cancelled meetings return 409 on join', async () => {
    const ended = await create(alice);
    await join(alice, ended).expect(200);
    await http().post(`/api/v1/meetings/${ended}/end`).set(alice.auth).expect(204);
    await join(bob, ended).expect(409);

    const cancelled = await create(alice, { mode: 'scheduled', scheduledAt: inHours(2) });
    await http().post(`/api/v1/meetings/${cancelled}/cancel`).set(alice.auth).expect(204);
    const res = await join(bob, cancelled).expect(409);
    expect(res.body.error.message).toBe('This meeting has already ended');
  });

  it('host ends: ENDED, sessions closed, room removed, audit with reason host; repeat is 204 without another audit; the ended hook runs once', async () => {
    const id = await create(alice);
    await join(alice, id).expect(200);
    await ctx.prisma.meetingAttendance.create({
      data: { meetingId: id, userId: bob.userId, joinedAt: new Date() },
    });
    await http().post(`/api/v1/meetings/${id}/end`).set(bob.auth).expect(403);
    await http().post(`/api/v1/meetings/${id}/end`).set(alice.auth).expect(204);
    const row = await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'ENDED', endReason: 'host' });
    expect(row.endedAt).not.toBeNull();
    expect(
      await ctx.prisma.meetingAttendance.count({ where: { meetingId: id, leftAt: null } }),
    ).toBe(0);
    expect(ctx.media.ended).toContain(`luna-${id}`);
    expect(ctx.media.rooms.has(`luna-${id}`)).toBe(false);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'meeting.end', targetId: id },
    });
    expect(audit).toMatchObject({ actorId: alice.userId });
    expect(audit.metadata).toMatchObject({ reason: 'host' });
    await http().post(`/api/v1/meetings/${id}/end`).set(alice.auth).expect(204);
    expect(await countAudit('meeting.end', id)).toBe(1);
  });

  it('ending a meeting that has not started is 409', async () => {
    const id = await create(alice);
    await http().post(`/api/v1/meetings/${id}/end`).set(alice.auth).expect(409);
  });

  it('only the host mutes others and toggles AI notes; others get 403', async () => {
    const id = await create(alice);
    await join(alice, id).expect(200);
    await join(bob, id).expect(200);
    ctx.media.rooms.get(`luna-${id}`)!.participants.push({
      identity: bob.userId,
      joinedAt: new Date(),
      hidden: false,
    });
    await http()
      .post(`/api/v1/meetings/${id}/participants/${bob.userId}/mute`)
      .set(bob.auth)
      .expect(403);
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(bob.auth)
      .send({ enabled: false })
      .expect(403);

    const mute = await http()
      .post(`/api/v1/meetings/${id}/participants/${bob.userId}/mute`)
      .set(alice.auth)
      .expect(200);
    expect(mute.body).toEqual({ muted: true });
    expect(ctx.media.muted).toContainEqual({ roomName: `luna-${id}`, identity: bob.userId });
    const muteAudit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'meeting.mute_participant', targetId: id },
    });
    expect(muteAudit.metadata).toEqual({ userId: bob.userId });
    const absent = await http()
      .post(`/api/v1/meetings/${id}/participants/${carol.userId}/mute`)
      .set(alice.auth)
      .expect(200);
    expect(absent.body).toEqual({ muted: false });

    const toggled = await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: false })
      .expect(200);
    expect(toggled.body).toEqual({ aiNotesEnabled: false });
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } })).aiNotesEnabled).toBe(
      false,
    );
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata).aiNotesEnabled).toBe(false);
    expect(ctx.media.broadcasts).toContainEqual({
      roomName: `luna-${id}`,
      topic: 'luna.meeting',
      payload: { type: 'ai_notes', enabled: false },
    });
    expect(await countAudit('meeting.ai_notes_toggle', id)).toBe(1);
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: 'yes' })
      .expect(400);
  });

  it('AI notes can be toggled before the meeting starts without touching media, and not after it ended', async () => {
    const id = await create(alice);
    const before = ctx.media.broadcasts.length;
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: false })
      .expect(200);
    expect(ctx.media.broadcasts.length).toBe(before);
    await join(alice, id).expect(200);
    await http().post(`/api/v1/meetings/${id}/end`).set(alice.auth).expect(204);
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: true })
      .expect(409);
  });

  it('a media failure while creating the room gives 503 and the meeting stays LIVE so joining again works', async () => {
    const id = await create(alice);
    ctx.media.failNext('ensureRoom', new Error('livekit down'));
    const res = await join(alice, id).expect(503);
    expect(res.body.error.message).toBe(
      'The meeting service is unavailable, try again in a moment',
    );
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } })).status).toBe('LIVE');
    await join(alice, id).expect(200);
    expect(await countAudit('meeting.start', id)).toBe(1);

    ctx.media.failNext('joinToken', new Error('token fail'));
    await join(bob, id).expect(503);
  });
});
