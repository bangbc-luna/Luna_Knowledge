import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { purgeExpiredTrash } from '@luna/db';
import { JOBS, QUEUES } from '@luna/shared';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';
import { PrismaService } from '../infra/prisma.provider.js';
import { StorageService } from '../infra/storage.provider.js';

const GC_BATCH = 200;
const GC_MAX_ATTEMPTS = 10;
const KEEP_FINISHED_UPLOADS_DAYS = 7;
const STALE_WORKDIR_HOURS = 12;

@Processor(QUEUES.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUES.MAINTENANCE) private readonly queue: Queue,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    const opts = { removeOnComplete: 30, removeOnFail: 100 };
    await this.queue.upsertJobScheduler(
      JOBS.PURGE_TRASH,
      { pattern: '0 3 * * *', tz: 'Asia/Ho_Chi_Minh' },
      { name: JOBS.PURGE_TRASH, opts },
    );
    await this.queue.upsertJobScheduler(
      JOBS.CLEAN_UPLOADS,
      { pattern: '17 * * * *' },
      { name: JOBS.CLEAN_UPLOADS, opts },
    );
    await this.queue.upsertJobScheduler(
      JOBS.BLOB_GC,
      { every: 10 * 60_000 },
      { name: JOBS.BLOB_GC, opts },
    );
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOBS.PURGE_TRASH: {
        const purged = await purgeExpiredTrash(this.prisma.client);
        this.logger.log(`Purged ${purged} expired trash item(s)`);
        const gc = await this.collectGarbage();
        return { purged, ...gc };
      }
      case JOBS.CLEAN_UPLOADS:
        return { ...(await this.cleanUploads()), staleWorkDirs: await this.cleanWorkDirs() };
      case JOBS.BLOB_GC:
        return this.collectGarbage();
      default:
        throw new Error(`Unknown job "${job.name}" on queue ${QUEUES.MAINTENANCE}`);
    }
  }

  async collectGarbage() {
    let deleted = 0;
    let failed = 0;
    for (;;) {
      const rows = await this.prisma.client.blobGc.findMany({
        where: { attempts: { lt: GC_MAX_ATTEMPTS } },
        orderBy: { id: 'asc' },
        take: GC_BATCH,
        skip: failed,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        try {
          await this.storage.forRef(row).delete(row);
          await this.prisma.client.blobGc.delete({ where: { id: row.id } });
          deleted++;
        } catch (err) {
          failed++;
          await this.prisma.client.blobGc.update({
            where: { id: row.id },
            data: { attempts: { increment: 1 }, lastError: (err as Error).message.slice(0, 500) },
          });
        }
      }
      if (rows.length < GC_BATCH) break;
    }
    if (deleted || failed) this.logger.log(`Blob GC: deleted ${deleted}, failed ${failed}`);
    return { deleted, failed };
  }

  async cleanWorkDirs(now = Date.now()) {
    const root = this.config.WORKER_TMP_DIR ?? tmpdir();
    let removed = 0;
    for (const name of await readdir(root).catch(() => [] as string[])) {
      if (!/^luna-(file|regen|video)-/.test(name)) continue;
      const dir = join(root, name);
      const info = await stat(dir).catch(() => null);
      if (info?.isDirectory() && now - info.mtimeMs > STALE_WORKDIR_HOURS * 3600_000) {
        await rm(dir, { recursive: true, force: true });
        removed++;
      }
    }
    if (removed) this.logger.log(`Removed ${removed} stale work dir(s) in ${root}`);
    return removed;
  }

  async cleanUploads(now = new Date()) {
    const expired = await this.prisma.client.uploadSession.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      take: 500,
    });
    for (const s of expired) {
      await this.storage.s3
        .send(
          new AbortMultipartUploadCommand({
            Bucket: this.storage.buckets.tmp,
            Key: s.tmpKey,
            UploadId: s.s3UploadId,
          }),
        )
        .catch(() => undefined);
      await this.prisma.client.uploadSession.update({
        where: { id: s.id },
        data: { status: 'ABORTED' },
      });
      if (!s.isNewVersion) {
        await this.prisma.client.node.deleteMany({ where: { id: s.nodeId, status: 'UPLOADING' } });
      }
    }
    const { count: removed } = await this.prisma.client.uploadSession.deleteMany({
      where: {
        status: { in: ['COMPLETED', 'ABORTED'] },
        createdAt: { lt: new Date(now.getTime() - KEEP_FINISHED_UPLOADS_DAYS * 86_400_000) },
      },
    });
    if (expired.length) this.logger.log(`Aborted ${expired.length} expired upload(s)`);
    return { aborted: expired.length, removed };
  }
}
