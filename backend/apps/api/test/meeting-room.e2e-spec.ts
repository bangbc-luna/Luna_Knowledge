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
      aiNotesVersion: 0,
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
      version: 0,
    });
    await join(bob, id).expect(200);
    expect(await countAudit('meeting.start', id)).toBe(1);
  });

  it('two simultaneous joins start the meeting only once', async () => {
    const id = await create(alice);
    const results = await Promise.all([join(alice, id), join(bob, id)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
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
    expect(muteAudit.metadata).toEqual({ userId: bob.userId, muted: true });
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
    expect(toggled.body).toEqual({ aiNotesEnabled: false, aiNotesVersion: 1 });
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } })).aiNotesEnabled).toBe(
      false,
    );
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata)).toMatchObject({
      aiNotesEnabled: false,
      version: 1,
    });
    expect(ctx.media.broadcasts).toContainEqual({
      roomName: `luna-${id}`,
      topic: 'luna.meeting',
      payload: { type: 'ai_notes', enabled: false, version: 1 },
    });
    expect(await countAudit('meeting.ai_notes_toggle', id)).toBe(1);
    const versions = [toggled.body.aiNotesVersion];
    for (const enabled of [true, false]) {
      const next = await http()
        .put(`/api/v1/meetings/${id}/ai-notes`)
        .set(alice.auth)
        .send({ enabled })
        .expect(200);
      versions.push(next.body.aiNotesVersion);
    }
    expect(versions).toEqual([1, 2, 3]);
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } })).aiNotesVersion).toBe(3);
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata).version).toBe(3);
    expect(
      ctx.media.broadcasts
        .filter((b) => b.roomName === `luna-${id}`)
        .map((b) => (b.payload as { version: number }).version),
    ).toEqual([1, 2, 3]);
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

  it('ai-notes media failure gives 503 and a retry re-syncs the room metadata', async () => {
    const id = await create(alice);
    await join(alice, id).expect(200);
    const original = ctx.media.setRoomMetadata.bind(ctx.media);
    ctx.media.setRoomMetadata = async () => {
      throw new Error('livekit down');
    };
    const res = await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: false })
      .expect(503);
    expect(res.body.error.message).toBe(
      'The meeting service is unavailable, try again in a moment',
    );
    ctx.media.setRoomMetadata = original;
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: false })
      .expect(200);
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata).aiNotesEnabled).toBe(false);
  });

  it('ai-notes sync retries once after a single media failure', async () => {
    const id = await create(alice);
    await join(alice, id).expect(200);
    ctx.media.failNext('setRoomMetadata', new Error('blip'));
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: false })
      .expect(200);
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata).aiNotesEnabled).toBe(false);
  });

  it('join syncs the room metadata and response with the current DB value', async () => {
    const id = await create(alice);
    await join(alice, id).expect(200);
    await ctx.prisma.meeting.update({ where: { id }, data: { aiNotesEnabled: false } });
    const res = await join(bob, id).expect(200);
    expect(res.body.aiNotesEnabled).toBe(false);
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata).aiNotesEnabled).toBe(false);
  });

  it('mute records muted in the audit, rejects a bad user id and maps media failure to 503', async () => {
    const id = await create(alice);
    await join(alice, id).expect(200);
    await http()
      .post(`/api/v1/meetings/${id}/participants/${carol.userId}/mute`)
      .set(alice.auth)
      .expect(200);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'meeting.mute_participant', targetId: id },
    });
    expect(audit.metadata).toEqual({ userId: carol.userId, muted: false });
    await http()
      .post(`/api/v1/meetings/${id}/participants/not-a-uuid/mute`)
      .set(alice.auth)
      .expect(400);
    ctx.media.failNext('muteMicrophone', new Error('livekit down'));
    await http()
      .post(`/api/v1/meetings/${id}/participants/${carol.userId}/mute`)
      .set(alice.auth)
      .expect(503);
  });

  it('joining a SCHEDULED meeting more than 15 minutes early is 409 for non-managers and leaves it SCHEDULED; managers and the early window are allowed', async () => {
    const id = await create(alice, { mode: 'scheduled', scheduledAt: inHours(3) });
    const early = await join(bob, id).expect(409);
    expect(early.body.error.message).toBe('This meeting has not started yet');
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } })).status).toBe(
      'SCHEDULED',
    );
    expect(ctx.media.rooms.has(`luna-${id}`)).toBe(false);
    const detail = await http().get(`/api/v1/meetings/${id}`).set(bob.auth).expect(200);
    const scheduledAt = new Date(detail.body.scheduledAt).getTime();
    expect(new Date(detail.body.opensAt).getTime()).toBe(scheduledAt - 15 * 60_000);
    await join(alice, id).expect(200);
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } })).status).toBe('LIVE');
    const live = await http().get(`/api/v1/meetings/${id}`).set(bob.auth).expect(200);
    expect(live.body.opensAt).toBeNull();

    const soon = await create(alice, {
      mode: 'scheduled',
      scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    await join(bob, soon).expect(200);
  });

  it('an admin who did not create the meeting may join it early', async () => {
    const id = await create(bob, { mode: 'scheduled', scheduledAt: inHours(3) });
    await join(alice, id).expect(200);
  });

  it('if the meeting ended while the room was being prepared, join ends the room and returns 409', async () => {
    const id = await create(alice);
    const original = ctx.media.joinToken.bind(ctx.media);
    ctx.media.joinToken = async (input) => {
      await ctx.prisma.meeting.update({
        where: { id },
        data: { status: 'ENDED', startedAt: new Date(), endedAt: new Date(), endReason: 'host' },
      });
      return original(input);
    };
    try {
      const res = await join(alice, id).expect(409);
      expect(res.body.error.message).toBe('This meeting has already ended');
    } finally {
      ctx.media.joinToken = original;
    }
    expect(ctx.media.ended).toContain(`luna-${id}`);
    expect(ctx.media.rooms.has(`luna-${id}`)).toBe(false);
  });

  it('switching AI notes on with a failed media sync reverts the DB, audits the revert and returns 503; a failed switch-off keeps the DB off', async () => {
    const id = await create(alice, { aiNotesEnabled: false });
    await join(alice, id).expect(200);
    ctx.media.failNext('setRoomMetadata', new Error('down'), 2);
    const res = await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: true })
      .expect(503);
    expect(res.body.error.message).toBe(
      'The meeting service is unavailable, try again in a moment',
    );
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } })).aiNotesEnabled).toBe(
      false,
    );
    const audits = await ctx.prisma.auditLog.findMany({
      where: { action: 'meeting.ai_notes_toggle', targetId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.metadata)).toEqual([
      { enabled: true },
      { enabled: false, reverted: true },
    ]);

    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: true })
      .expect(200);
    ctx.media.failNext('setRoomMetadata', new Error('down'), 2);
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: false })
      .expect(503);
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } })).aiNotesEnabled).toBe(
      false,
    );
    ctx.media.failNext('broadcast', new Error('down'), 2);
    await http()
      .put(`/api/v1/meetings/${id}/ai-notes`)
      .set(alice.auth)
      .send({ enabled: true })
      .expect(503);
    const row = await ctx.prisma.meeting.findUniqueOrThrow({ where: { id } });
    expect(row.aiNotesEnabled).toBe(false);
    expect(JSON.parse(ctx.media.rooms.get(`luna-${id}`)!.metadata)).toMatchObject({
      aiNotesEnabled: false,
      version: row.aiNotesVersion,
    });
  });

  it('ending closes open sessions even when joined_at is in the future', async () => {
    const id = await create(alice);
    await join(alice, id).expect(200);
    const future = new Date(Date.now() + 3_600_000);
    await ctx.prisma.meetingAttendance.create({
      data: { meetingId: id, userId: bob.userId, joinedAt: future },
    });
    await http().post(`/api/v1/meetings/${id}/end`).set(alice.auth).expect(204);
    const row = await ctx.prisma.meetingAttendance.findFirstOrThrow({
      where: { meetingId: id, userId: bob.userId },
    });
    expect(row.leftAt?.getTime()).toBe(future.getTime());
  });

  it('PUT hand sets the caller attribute, needs a LIVE meeting, access and the caller in the room', async () => {
    const id = await create(alice);
    const hand = (as: LoggedIn, raised: unknown) =>
      http().put(`/api/v1/meetings/${id}/hand`).set(as.auth).send({ raised });
    await hand(bob, true).expect(409);
    await join(alice, id).expect(200);
    await join(bob, id).expect(200);
    const room = ctx.media.rooms.get(`luna-${id}`)!;
    room.participants.push({ identity: bob.userId, joinedAt: new Date(), hidden: false });
    await hand(guest, true).expect(404);
    await hand(bob, 'yes').expect(400);
    const up = await hand(bob, true).expect(200);
    expect(up.body).toEqual({ raised: true });
    const down = await hand(bob, false).expect(200);
    expect(down.body).toEqual({ raised: false });
    expect(ctx.media.attributes).toEqual([
      { roomName: `luna-${id}`, identity: bob.userId, attributes: { handRaised: 'true' } },
      { roomName: `luna-${id}`, identity: bob.userId, attributes: { handRaised: '' } },
    ]);
    await hand(carol, true).expect(409);
    ctx.media.failNext('setParticipantAttributes', new Error('down'));
    await hand(bob, true).expect(503);
  });

  it('a deactivated user cannot join (rejected by the auth guard with 401)', async () => {
    const id = await create(alice);
    await ctx.prisma.user.update({ where: { id: bob.userId }, data: { status: 'DISABLED' } });
    await join(bob, id).expect(401);
    await ctx.prisma.user.update({ where: { id: bob.userId }, data: { status: 'ACTIVE' } });
  });
});
