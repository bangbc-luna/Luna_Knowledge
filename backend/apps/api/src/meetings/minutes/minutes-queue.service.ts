import { enqueueMinutes, enqueueRecording, type JobQueue, QUEUES } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MinutesQueueService {
  private readonly logger = new Logger(MinutesQueueService.name);

  constructor(
    @InjectQueue(QUEUES.MEETING_RECORDER)
    private readonly recorder: JobQueue<'meeting-recorder'>,
    @InjectQueue(QUEUES.MEETING_MINUTES)
    private readonly minutes: JobQueue<'meeting-minutes'>,
  ) {}

  async startRecording(meetingId: string): Promise<void> {
    try {
      await enqueueRecording(this.recorder, meetingId);
    } catch (err) {
      this.logger.error({ err, meetingId }, 'Could not enqueue the meeting recorder');
    }
  }

  retryMinutes(meetingId: string, attempt: number): Promise<void> {
    return enqueueMinutes(this.minutes, meetingId, { attempt });
  }
}
