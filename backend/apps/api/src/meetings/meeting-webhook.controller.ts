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
    const match = ROOM_NAME.exec(event.roomName);
    if (!match) return;
    const meetingId = match[1]!.toLowerCase();
    const db = this.prisma.client;
    const meeting = await db.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, status: true },
    });
    if (!meeting) return;
    if (event.kind === 'room_finished') {
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
    if (event.kind === 'participant_left') {
      const closed = await closeAttendance(db, meetingId, userId, event.at);
      if (!closed)
        await this.redis.set(marker, String(event.at.getTime()), 'EX', LEFT_MARKER_TTL_SEC);
      return;
    }
    if (meeting.status === 'ENDED' || meeting.status === 'CANCELLED') return;
    const stored = await this.redis.get(marker);
    const leftMs = stored === null ? NaN : Number(stored);
    if (stored !== null) await this.redis.del(marker);
    if (Number.isFinite(leftMs) && leftMs >= event.at.getTime()) {
      await db.meetingAttendance.create({
        data: { meetingId, userId, joinedAt: event.at, leftAt: new Date(leftMs) },
      });
      return;
    }
    await openAttendance(db, meetingId, userId, event.at);
  }
}
