import {
  closeAttendance,
  endMeeting,
  MEETING_ENDED_HOOK,
  MEETING_MEDIA,
  type MediaEvent,
  type MeetingEndedHook,
  type MeetingMedia,
  openAttendance,
} from '@luna/meetings';
import { Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { Public } from '../auth/decorators/public.decorator.js';
import { AppError } from '../common/errors/app-error.js';
import { REDIS } from '../infra/redis/redis.token.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

const DEDUPE_TTL_SEC = 86400;
const LEFT_MARKER_TTL_SEC = 60;
const RECORDER_IDENTITY = 'luna-recorder';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROOM_NAME = new RegExp(`^luna-(${UUID})$`, 'i');
const USER_ID = new RegExp(`^${UUID}$`, 'i');

@Controller('meetings/livekit')
export class MeetingWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEETING_MEDIA) private readonly media: MeetingMedia,
    @Inject(MEETING_ENDED_HOOK) private readonly onEnded: MeetingEndedHook,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(@Req() req: Request, @Headers('authorization') authorization?: string) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const event = await this.media.parseWebhook(raw, authorization);
    if (!event) throw AppError.unauthenticated('Invalid webhook signature');
    if (event.kind === 'ignored') return { ok: true };
    const key = `meeting-webhook:${event.eventId}`;
    const first = await this.redis.set(key, '1', 'EX', DEDUPE_TTL_SEC, 'NX');
    if (first !== 'OK') return { ok: true };
    try {
      await this.handle(event);
    } catch (err) {
      await this.redis.del(key).catch(() => undefined);
      throw err;
    }
    return { ok: true };
  }

  private async handle(event: MediaEvent): Promise<void> {
    if (event.kind === 'ignored') return;
    const match = ROOM_NAME.exec(event.roomName);
    if (!match) return;
    const meetingId = match[1]!.toLowerCase();
    const db = this.prisma.client;
    const meeting = await db.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, status: true, workspaceId: true, createdById: true, startedAt: true },
    });
    if (!meeting) return;
    if (event.kind === 'room_finished') {
      if (meeting.startedAt && event.at < meeting.startedAt) return;
      await endMeeting(
        { db, media: this.media, onEnded: this.onEnded },
        meetingId,
        'room_finished',
        null,
      );
      return;
    }
    if (event.kind !== 'participant_joined' && event.kind !== 'participant_left') return;
    if (event.identity === RECORDER_IDENTITY || !USER_ID.test(event.identity)) return;
    const userId = event.identity.toLowerCase();
    const marker = `meeting-left:${meetingId}:${userId}`;
    const leftAt = (ms: string | null) => (ms === null ? NaN : Number(ms));
    if (event.kind === 'participant_left') {
      await this.redis.set(marker, String(event.at.getTime()), 'EX', LEFT_MARKER_TTL_SEC);
      if (await closeAttendance(db, meetingId, userId, event.at)) await this.redis.del(marker);
      return;
    }
    if (meeting.status === 'ENDED' || meeting.status === 'CANCELLED') return;
    if (!(await this.mayAttend(meeting, userId))) return;
    const joinedMs = event.at.getTime();
    const before = leftAt(await this.redis.get(marker));
    if (Number.isFinite(before) && before >= joinedMs) {
      await this.redis.del(marker);
      await db.meetingAttendance.create({
        data: { meetingId, userId, joinedAt: event.at, leftAt: new Date(before) },
      });
      return;
    }
    await openAttendance(db, meetingId, userId, event.at);
    const after = leftAt(await this.redis.get(marker));
    if (Number.isFinite(after) && after >= joinedMs) {
      await closeAttendance(db, meetingId, userId, new Date(after));
    }
    if (!Number.isNaN(after) || !Number.isNaN(before)) await this.redis.del(marker);
  }

  private async mayAttend(
    meeting: { id: string; workspaceId: string; createdById: string },
    userId: string,
  ): Promise<boolean> {
    if (meeting.createdById === userId) return true;
    const db = this.prisma.client;
    const [member, invite] = await Promise.all([
      db.workspaceMember.findFirst({
        where: { workspaceId: meeting.workspaceId, userId },
        select: { userId: true },
      }),
      db.meetingInvite.findUnique({
        where: { meetingId_userId: { meetingId: meeting.id, userId } },
        select: { userId: true },
      }),
    ]);
    return member !== null || invite !== null;
  }
}
