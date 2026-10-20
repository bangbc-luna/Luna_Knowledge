import { QUEUES } from '@luna/shared';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

export interface PingResult {
  pong: true;
  receivedAt: string;
  workerPid: number;
}

/** Hàng đợi `system`: job chẩn đoán, dùng để kiểm tra đường đi API → Redis → worker. */
@Processor(QUEUES.SYSTEM)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  async process(job: Job): Promise<PingResult> {
    switch (job.name) {
      case 'ping':
        this.logger.debug(`ping job ${job.id}`);
        return { pong: true, receivedAt: new Date().toISOString(), workerPid: process.pid };
      default:
        throw new Error(`Unknown job "${job.name}" on queue ${QUEUES.SYSTEM}`);
    }
  }
}
