import { type Meeting, writeAudit } from '@luna/db';
import {
  encodeRoomMetadata,
  endMeeting,
  MEETING_ENDED_HOOK,
  MEETING_MEDIA,
  type MeetingEndedHook,
  type MeetingMedia,
  roomNameFor,
} from '@luna/meetings';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { MeetingAccess } from './meeting-access.service.js';

const ENDED_MESSAGE = 'This meeting has already ended';
const MEDIA_UNAVAILABLE = 'The meeting service is unavailable, try again in a moment';

const roomMetadata = (m: Pick<Meeting, 'title' | 'aiNotesEnabled' | 'createdById'>) =>
  encodeRoomMetadata({ title: m.title, aiNotesEnabled: m.aiNotesEnabled, hostId: m.createdById });

@Injectable()
export class MeetingRoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MeetingAccess,
    @Inject(MEETING_MEDIA) private readonly media: MeetingMedia,
    @Inject(MEETING_ENDED_HOOK) private readonly onEnded: MeetingEndedHook,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async join(user: AuthenticatedUser, meetingId: string, ctx: RequestContext) {
    const { meeting: seen, isHost } = await this.access.require(user, meetingId);
    if (seen.status === 'ENDED' || seen.status === 'CANCELLED') {
      throw AppError.conflict(ENDED_MESSAGE);
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
    try {
      const fresh = await this.prisma.client.meeting.findUniqueOrThrow({
        where: { id: meetingId },
      });
      aiNotesEnabled = fresh.aiNotesEnabled;
      await this.media.ensureRoom(roomName, roomMetadata(fresh));
      await this.media.setRoomMetadata(roomName, roomMetadata(fresh));
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
    return {
      serverUrl: this.media.serverUrl,
      token,
      roomName,
      identity: user.id,
      aiNotesEnabled,
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
    await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.meeting.updateMany({
        where: { id: meetingId, status: { in: ['SCHEDULED', 'LIVE'] } },
        data: { aiNotesEnabled: enabled },
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
        await this.media.setRoomMetadata(roomName, roomMetadata(fresh));
        await this.media.broadcast(roomName, 'luna.meeting', {
          type: 'ai_notes',
          enabled: fresh.aiNotesEnabled,
        });
      };
      try {
        await sync().catch(() => sync());
      } catch (err) {
        console.error('meeting ai notes sync failed', { meetingId, err });
        throw AppError.unavailable(MEDIA_UNAVAILABLE);
      }
    }
    return { aiNotesEnabled: fresh.aiNotesEnabled };
  }

  private requireLive(meeting: Meeting) {
    if (meeting.status === 'LIVE') return;
    throw AppError.conflict(
      meeting.status === 'SCHEDULED' ? 'This meeting has not started' : ENDED_MESSAGE,
    );
  }
}
