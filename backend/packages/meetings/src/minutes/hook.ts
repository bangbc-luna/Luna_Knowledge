import type { PrismaClient } from '@luna/db';
import { enqueueMinutes, type JobQueue } from '@luna/shared';
import type { MeetingEndedHook } from '../lifecycle.js';

export interface MeetingEndedHookDeps {
  db: Pick<PrismaClient, 'meetingMinutes'>;
  queue: JobQueue<'meeting-minutes'>;
  audioWaitSec: number;
}

export function meetingEndedHook(deps: MeetingEndedHookDeps): MeetingEndedHook {
  return async (meeting) => {
    const minutes = await deps.db.meetingMinutes.findUnique({
      where: { meetingId: meeting.id },
      select: { meetingId: true },
    });
    if (!minutes) return;
    await enqueueMinutes(deps.queue, meeting.id, { delayMs: deps.audioWaitSec * 1000 });
  };
}
