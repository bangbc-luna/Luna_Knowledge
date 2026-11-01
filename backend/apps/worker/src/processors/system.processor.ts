import { QUEUES, type QueueJob, unknownJob } from '@luna/shared';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

export interface PingResult {
  pong: true;
  receivedAt: string;
  workerPid: number;
}

@Processor(QUEUES.SYSTEM)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  async process(job: Job): Promise<PingResult> {
    const j = job as unknown as QueueJob<'system'>;
    switch (j.name) {
      case 'ping':
        this.logger.debug(`ping job ${job.id}`);
        return { pong: true, receivedAt: new Date().toISOString(), workerPid: process.pid };
      default:
        throw new Error(`Unknown job "${unknownJob(j.name)}" on queue ${QUEUES.SYSTEM}`);
    }
  }
}
