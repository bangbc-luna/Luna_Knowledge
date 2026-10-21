import { JOBS, QUEUES, type TranscodeJob, transcodeJobOptions } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../infra/prisma/prisma.service.js';

/** Một chỗ duy nhất ở API đẩy job transcode (khôi phục phiên bản, tạo lại, transcode lại). */
@Injectable()
export class TranscodeQueueService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.VIDEO_TRANSCODE) private readonly queue: Queue,
  ) {}

  async enqueue(nodeId: string, versionId: string) {
    const version = await this.prisma.client.fileVersion.findUnique({
      where: { id: versionId },
      select: { original: { select: { sizeBytes: true } } },
    });
    await this.queue.add(
      JOBS.TRANSCODE,
      { nodeId, versionId } satisfies TranscodeJob,
      transcodeJobOptions(version?.original.sizeBytes ?? 0),
    );
  }
}
