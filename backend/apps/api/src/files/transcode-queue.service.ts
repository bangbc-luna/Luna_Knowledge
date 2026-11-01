import { enqueueTranscode, type JobQueue, QUEUES } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service.js';

@Injectable()
export class TranscodeQueueService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.VIDEO_TRANSCODE) private readonly queue: JobQueue<'video-transcode'>,
  ) {}

  async enqueue(nodeId: string, versionId: string) {
    const version = await this.prisma.client.fileVersion.findUnique({
      where: { id: versionId },
      select: { original: { select: { sizeBytes: true } } },
    });
    await enqueueTranscode(this.queue, { nodeId, versionId }, version?.original.sizeBytes ?? 0);
  }
}
