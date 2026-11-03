import { type Meeting, writeAudit } from '@luna/db';
import {
  encodeRoomMetadata,
  endMeeting,
  MEETING_ENDED_HOOK,
  MEETING_MEDIA,
  type MeetingEndedHook,
  type MeetingMedia,
  minutesAiAvailable,
  roomNameFor,
} from '@luna/meetings';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { MeetingAccess } from './meeting-access.service.js';
import { MinutesQueueService } from './minutes/minutes-queue.service.js';

const ENDED_MESSAGE = 'This meeting has already ended';
const NOT_STARTED_YET_MESSAGE = 'This meeting has not started yet';
const MEDIA_UNAVAILABLE = 'The meeting service is unavailable, try again in a moment';

const AI_NOT_CONFIGURED = 'AI minutes are not configured';

const roomMetadata = (
  m: Pick<Meeting, 'title' | 'aiNotesEnabled' | 'aiNotesVersion' | 'createdById'>,
  aiAvailable: boolean,
) =>
  encodeRoomMetadata({
    title: m.title,
    aiNotesEnabled: m.aiNotesEnabled && aiAvailable,
    hostId: m.createdById,
    version: m.aiNotesVersion,
  });

@Injectable()
export class MeetingRoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeetingAccess,
    private readonly minutesQueue: MinutesQueueService,
    @Inject(MEETING_MEDIA) private readonly media: MeetingMedia,
    @Inject(MEETING_ENDED_HOOK) private readonly onEnded: MeetingEndedHook,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get aiAvailable() {
    return minutesAiAvailable(this.config);
  }

  async join(user: AuthenticatedUser, meetingId: string, ctx: RequestContext) {
    const { meeting: seen, isHost, canManage } = await this.access.require(user, meetingId);
    if (seen.status === 'ENDED' || seen.status === 'CANCELLED') {
      throw AppError.conflict(ENDED_MESSAGE);
    }
    if (
      seen.status === 'SCHEDULED' &&
      !canManage &&
      seen.scheduledAt &&
      seen.scheduledAt.getTime() > Date.now() + this.config.MEETING_EARLY_JOIN_MIN * 60_000
    ) {
      throw AppError.conflict(NOT_STARTED_YET_MESSAGE);
    }
    await this.prisma.client.$transaction(async (tx) => {
      const started = await tx.$queryRaw<{ id: string }[]>`UPDATE meetings
           SET status = 'LIVE', started_at = now(), updated_at = now()
         WHERE id = ${meetingId}::uuid AND status = 'SCHEDULED'
         RETURNING id::text`;
      const current = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId } });
      if (current.status === 'ENDED' || current.status === 'CANCELLED') {
        throw AppError.conflict(ENDED_MESSAGE);
      }
      if (started.length > 0) {
        await writeAudit(tx, {
          actorId: user.id,
          action: 'meeting.start',
          targetType: 'meeting',
          targetId: meetingId,
          workspaceId: current.workspaceId,
          metadata: { title: current.title },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
    });
    const roomName = roomNameFor(meetingId);
    let token: string;
    let aiNotesEnabled: boolean;
    let aiNotesVersion: number;
    try {
      const fresh = await this.prisma.client.meeting.findUniqueOrThrow({
        where: { id: meetingId },
      });
      aiNotesEnabled = fresh.aiNotesEnabled && this.aiAvailable;
      aiNotesVersion = fresh.aiNotesVersion;
      if (fresh.status === 'LIVE' && aiNotesEnabled) {
        await this.minutesQueue.startRecording(meetingId);
      }
      await this.media.ensureRoom(roomName, roomMetadata(fresh, this.aiAvailable));
      await this.media.setRoomMetadata(roomName, roomMetadata(fresh, this.aiAvailable));
      token = await this.media.joinToken({
        roomName,
        identity: user.id,
        name: user.name,
        role: isHost ? 'host' : 'participant',
        metadata: JSON.stringify({ avatarUrl: user.avatarUrl }),
      });
    } catch (err) {
      console.error('meeting join media failed', { meetingId, err });
      throw AppError.unavailable(MEDIA_UNAVAILABLE);
    }
    const after = await this.prisma.client.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { status: true },
    });
    if (after.status !== 'LIVE') {
      try {
        await this.media.endRoom(roomName);
      } catch (err) {
        console.error('meeting join cleanup endRoom failed', { meetingId, err });
      }
      throw AppError.conflict(ENDED_MESSAGE);
    }
    return {
      serverUrl: this.media.serverUrl,
      token,
      roomName,
      identity: user.id,
      aiNotesEnabled,
      aiNotesVersion,
      isHost,
      expiresInSec: this.config.MEETING_TOKEN_TTL_SEC,
    };
  }

  async end(user: AuthenticatedUser, meetingId: string) {
    const { meeting } = await this.access.requireHost(user, meetingId);
    if (meeting.status === 'ENDED') return;
    if (meeting.status === 'CANCELLED') throw AppError.conflict(ENDED_MESSAGE);
    if (meeting.status === 'SCHEDULED') throw AppError.conflict('This meeting has not started');
    await endMeeting(
      { db: this.prisma.client, media: this.media, onEnded: this.onEnded },
      meetingId,
      'host',
      user.id,
    );
  }

  async mute(user: AuthenticatedUser, meetingId: string, targetId: string, ctx: RequestContext) {
    const { meeting } = await this.access.requireHost(user, meetingId);
    this.requireLive(meeting);
    let muted: boolean;
    try {
      muted = await this.media.muteMicrophone(roomNameFor(meetingId), targetId);
    } catch (err) {
      console.error('meeting mute failed', { meetingId, err });
      throw AppError.unavailable(MEDIA_UNAVAILABLE);
    }
    try {
      await writeAudit(this.prisma.client, {
        actorId: user.id,
        action: 'meeting.mute_participant',
        targetType: 'meeting',
        targetId: meetingId,
        workspaceId: meeting.workspaceId,
        metadata: { userId: targetId, muted },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (err) {
      console.error('meeting mute audit failed', { meetingId, err });
    }
    return { muted };
  }

  async setAiNotes(
    user: AuthenticatedUser,
    meetingId: string,
    enabled: boolean,
    ctx: RequestContext,
  ) {
    const { meeting } = await this.access.requireHost(user, meetingId);
    if (meeting.status === 'ENDED' || meeting.status === 'CANCELLED') {
      throw AppError.conflict(ENDED_MESSAGE);
    }
    if (enabled && !this.aiAvailable) throw AppError.conflict(AI_NOT_CONFIGURED);
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.meeting.updateMany({
        where: { id: meetingId, status: { in: ['SCHEDULED', 'LIVE'] } },
        data: { aiNotesEnabled: enabled, aiNotesVersion: { increment: 1 } },
      });
      if (count === 0) throw AppError.conflict(ENDED_MESSAGE);
      await writeAudit(tx, {
        actorId: user.id,
        action: 'meeting.ai_notes_toggle',
        targetType: 'meeting',
        targetId: meetingId,
        workspaceId: meeting.workspaceId,
        metadata: { enabled },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    });
    const fresh = await this.prisma.client.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    if (fresh.status === 'LIVE') {
      const roomName = roomNameFor(meetingId);
      const sync = async () => {
        await this.media.setRoomMetadata(roomName, roomMetadata(fresh, this.aiAvailable));
        await this.media.broadcast(roomName, 'luna.meeting', {
          type: 'ai_notes',
          enabled: fresh.aiNotesEnabled,
          version: fresh.aiNotesVersion,
        });
      };
      try {
        await sync().catch(() => sync());
      } catch (err) {
        console.error('meeting ai notes sync failed', { meetingId, err });
        if (enabled) await this.revertAiNotes(meetingId, meeting.workspaceId, user.id, ctx);
        throw AppError.unavailable(MEDIA_UNAVAILABLE);
      }
      if (enabled && fresh.aiNotesEnabled) await this.minutesQueue.startRecording(meetingId);
    }
    return { aiNotesEnabled: fresh.aiNotesEnabled, aiNotesVersion: fresh.aiNotesVersion };
  }

  private async revertAiNotes(
    meetingId: string,
    workspaceId: string,
    actorId: string,
    ctx: RequestContext,
  ) {
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.meeting.updateMany({
          where: { id: meetingId, status: { in: ['SCHEDULED', 'LIVE'] } },
          data: { aiNotesEnabled: false, aiNotesVersion: { increment: 1 } },
        });
        await writeAudit(tx, {
          actorId,
          action: 'meeting.ai_notes_toggle',
          targetType: 'meeting',
          targetId: meetingId,
          workspaceId,
          metadata: { enabled: false, reverted: true },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      });
    } catch (err) {
      console.error('meeting ai notes revert failed', { meetingId, err });
    }
  }

  async setHand(user: AuthenticatedUser, meetingId: string, raised: boolean) {
    const { meeting } = await this.access.require(user, meetingId);
    this.requireLive(meeting);
    let updated: boolean;
    try {
      updated = await this.media.setParticipantAttributes(roomNameFor(meetingId), user.id, {
        handRaised: raised ? 'true' : '',
      });
    } catch (err) {
      console.error('meeting hand failed', { meetingId, err });
      throw AppError.unavailable(MEDIA_UNAVAILABLE);
    }
    if (!updated) throw AppError.conflict('You are not in the meeting room');
    return { raised };
  }

  private requireLive(meeting: Meeting) {
    if (meeting.status === 'LIVE') return;
    throw AppError.conflict(
      meeting.status === 'SCHEDULED' ? 'This meeting has not started' : ENDED_MESSAGE,
    );
  }
}
