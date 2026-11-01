import { Prisma, type PrismaClient, writeAudit } from '@luna/db';
import type { MeetingMedia } from './media/meeting-media.js';

export type EndReason = 'host' | 'empty' | 'room_finished';

export interface EndedMeeting {
  id: string;
  workspaceId: string;
  aiNotesEnabled: boolean;
}

export type MeetingEndedHook = (meeting: EndedMeeting) => Promise<void>;

export const MEETING_ENDED_HOOK = Symbol('MEETING_ENDED_HOOK');

export const roomNameFor = (meetingId: string): string => `luna-${meetingId}`;

export interface EndMeetingDeps {
  db: PrismaClient;
  media: MeetingMedia;
  onEnded?: MeetingEndedHook;
}

export async function endMeeting(
  deps: EndMeetingDeps,
  meetingId: string,
  reason: EndReason,
  actorId: string | null,
): Promise<boolean> {
  const ended = await deps.db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; workspace_id: string; ai_notes_enabled: boolean; ended_at: Date }[]
    >`UPDATE meetings
         SET status = 'ENDED', ended_at = now(), end_reason = ${reason}, updated_at = now()
       WHERE id = ${meetingId}::uuid AND status = 'LIVE'
       RETURNING id::text, workspace_id::text, ai_notes_enabled, ended_at`;
    const row = rows[0];
    if (!row) return null;
    await tx.meetingAttendance.updateMany({
      where: { meetingId, leftAt: null },
      data: { leftAt: row.ended_at },
    });
    await writeAudit(tx, {
      actorId,
      action: 'meeting.end',
      targetType: 'meeting',
      targetId: meetingId,
      workspaceId: row.workspace_id,
      metadata: { reason },
    });
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      aiNotesEnabled: row.ai_notes_enabled,
    } satisfies EndedMeeting;
  });
  if (!ended) return false;
  try {
    await deps.media.endRoom(roomNameFor(meetingId));
  } catch (err) {
    console.error('meeting endRoom failed', { meetingId, err });
  }
  try {
    await deps.onEnded?.(ended);
  } catch (err) {
    console.error('meeting onEnded hook failed', { meetingId, err });
  }
  return true;
}

export async function openAttendance(
  db: Pick<PrismaClient, 'meetingAttendance'>,
  meetingId: string,
  userId: string,
  at: Date,
): Promise<void> {
  try {
    await db.meetingAttendance.create({ data: { meetingId, userId, joinedAt: at } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
}

export async function closeAttendance(
  db: Pick<PrismaClient, 'meetingAttendance'>,
  meetingId: string,
  userId: string,
  at: Date,
): Promise<boolean> {
  const { count } = await db.meetingAttendance.updateMany({
    where: { meetingId, userId, leftAt: null, joinedAt: { lte: at } },
    data: { leftAt: at },
  });
  return count > 0;
}
