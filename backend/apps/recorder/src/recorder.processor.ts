import { QUEUES, type QueueJob, recorderBackoffMs, unknownJob } from '@luna/shared';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import { RECORDER_CONFIG, type RecorderConfig } from './config.js';
import { RecordingAborted, type RecordingResult, RecordingSession } from './recording-session.js';

const RESTART_DELAY_MS = 5000;

@Processor(QUEUES.MEETING_RECORDER, {
  lockDuration: 60_000,
  settings: { backoffStrategy: (attemptsMade: number) => recorderBackoffMs(attemptsMade) },
})
export class RecorderProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RecorderProcessor.name);
  private readonly shutdown = new AbortController();
  private readonly active = new Set<Promise<unknown>>();

  constructor(
    private readonly session: RecordingSession,
    @Inject(RECORDER_CONFIG) private readonly config: RecorderConfig,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.concurrency = this.config.MEETING_RECORDER_CONCURRENCY;
  }

  async onModuleDestroy() {
    this.shutdown.abort();
    await Promise.allSettled(this.active);
  }

  async process(job: Job, token?: string): Promise<RecordingResult> {
    const j = job as unknown as QueueJob<'meeting-recorder'>;
    if (j.name !== 'record') {
      throw new Error(
        `Unknown job "${unknownJob(j as never)}" on queue ${QUEUES.MEETING_RECORDER}`,
      );
    }
    return this.record(job, j.data.meetingId, token);
  }

  private async record(job: Job, meetingId: string, token?: string): Promise<RecordingResult> {
    try {
      const running = this.session.run(meetingId, this.shutdown.signal);
      this.active.add(running);
      const result = await running.finally(() => this.active.delete(running));
      this.logger.log(`Recording of meeting ${meetingId} finished: ${result}`);
      return result;
    } catch (err) {
      if (err instanceof RecordingAborted) {
        await job.moveToDelayed(Date.now() + RESTART_DELAY_MS, token);
        throw new DelayedError();
      }
      throw err;
    }
  }
}
