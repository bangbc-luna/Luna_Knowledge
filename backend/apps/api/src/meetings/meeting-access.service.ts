import type { Meeting, WorkspaceRole } from '@luna/db';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

export interface MeetingAccessResult {
  meeting: Meeting;
  isHost: boolean;
  memberRole: WorkspaceRole | null;
  invited: boolean;
}

@Injectable()
export class MeetingAccess {
  constructor(private readonly prisma: PrismaService) {}

  async require(user: AuthenticatedUser, meetingId: string): Promise<MeetingAccessResult> {
    const meeting = await this.prisma.client.meeting.findFirst({
      where: { id: meetingId, workspace: { deletedAt: null } },
    });
    if (!meeting) throw AppError.notFound('Meeting not found');
    const [account, member, invite] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: user.id }, select: { status: true } }),
      this.prisma.client.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: meeting.workspaceId, userId: user.id } },
        select: { role: true },
      }),
      this.prisma.client.meetingInvite.findUnique({
        where: { meetingId_userId: { meetingId, userId: user.id } },
        select: { userId: true },
      }),
    ]);
    if (account?.status !== 'ACTIVE' || (!member && !invite)) {
      throw AppError.notFound('Meeting not found');
    }
    return {
      meeting,
      isHost: meeting.createdById === user.id,
      memberRole: member?.role ?? null,
      invited: !!invite,
    };
  }

  async requireHost(user: AuthenticatedUser, meetingId: string): Promise<MeetingAccessResult> {
    const result = await this.require(user, meetingId);
    if (!result.isHost) throw AppError.forbidden('Only the meeting host can do this');
    return result;
  }
}
