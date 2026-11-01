import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { BlobKind } from '@luna/db';
import {
  QUEUES,
  type QueueJob,
  reportError,
  sealVideoKey,
  type TranscodeJob,
  unknownJob,
} from '@luna/shared';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import sharp from 'sharp';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';
import { PrismaService } from '../infra/prisma.provider.js';
import { NodeEventsPublisher } from '../infra/redis.provider.js';
import { StorageService } from '../infra/storage.provider.js';
import {
  buildLadder,
  buildSprite,
  extractPoster,
  type FfmpegTools,
  InvalidVideoError,
  probe,
  transcodeHls,
} from '../processing/ffmpeg.js';

const CONTENT_TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
};
const UPLOAD_PARALLEL = 8;

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out;
}

interface NewBlob {
  kind: BlobKind;
  container: string;
  key: string;
  sizeBytes: bigint;
  mime: string;
}

@Processor(QUEUES.VIDEO_TRANSCODE)
export class VideoTranscodeProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(VideoTranscodeProcessor.name);
  private readonly tools: FfmpegTools;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: NodeEventsPublisher,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {
    super();
    this.tools = {
      ffmpeg: config.FFMPEG_PATH,
      ffprobe: config.FFPROBE_PATH,
      encoder: config.VIDEO_ENCODER,
      threads: config.FFMPEG_THREADS,
      nice: config.FFMPEG_NICE,
    };
  }

  onApplicationBootstrap() {
    this.worker.concurrency = this.config.VIDEO_TRANSCODE_CONCURRENCY;
  }

  async process(job: Job): Promise<unknown> {
    const j = job as unknown as QueueJob<'video-transcode'>;
    if (j.name !== 'transcode')
      throw new Error(`Unknown job "${unknownJob(j.name)}" on queue ${QUEUES.VIDEO_TRANSCODE}`);
    try {
      return await this.transcode(j.data);
    } catch (err) {
      if (err instanceof InvalidVideoError) {
        this.logger.warn({ nodeId: j.data.nodeId, detail: err.detail }, err.message);
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, err: Error) {
    if (!job) return;
    const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!final) return;
    if (!(err instanceof UnrecoverableError))
      reportError(err, { queue: job.queueName, job: job.name, data: job.data });
    const { nodeId, versionId } = job.data as TranscodeJob;
    const message =
      err instanceof UnrecoverableError
        ? err.message
        : 'Video processing failed, please try again later';
    try {
      const [info, playable] = await Promise.all([
        this.prisma.client.fileInfo.findUnique({
          where: { nodeId },
          select: { currentVersionId: true },
        }),
        this.prisma.client.video.findUnique({ where: { nodeId }, select: { versionId: true } }),
      ]);
      if (info?.currentVersionId !== versionId) return;
      const status = playable?.versionId === versionId ? 'READY' : 'FAILED';
      await this.prisma.client.fileInfo.upsert({
        where: { nodeId },
        create: { nodeId, processingError: message },
        update: { processingError: message },
      });
      await this.prisma.client.node.update({ where: { id: nodeId }, data: { status } });
      await this.events.publish({ nodeId, status, error: message });
      await this.notifyUploader(nodeId, versionId, 'video.failed', { error: message });
    } catch (e) {
      this.logger.warn({ err: e, nodeId }, 'Could not mark video as failed');
    }
  }

  async transcode({ nodeId, versionId }: TranscodeJob) {
    const version = await this.prisma.client.fileVersion.findFirst({
      where: { id: versionId, nodeId },
      include: { original: true, node: { select: { type: true } } },
    });
    if (!version || version.node.type !== 'VIDEO') return { skipped: 'version not found' };
    if (!(await this.isCurrent(nodeId, versionId))) return { skipped: 'not the current version' };

    const workDir = await mkdtemp(join(this.config.WORKER_TMP_DIR ?? tmpdir(), 'luna-video-'));
    const bucket = this.storage.buckets.hls;
    const prefix = `${nodeId}/${versionId}-${randomBytes(4).toString('hex')}/`;
    const thumbBucket = this.storage.buckets.thumbnails;
    const written: Array<{ container: string; key: string }> = [];
    let lastPublish = 0;
    const progress = (p: number) => {
      const now = Date.now();
      if (now - lastPublish < 1000) return;
      lastPublish = now;
      void this.events.publish({ nodeId, status: 'PROCESSING', progress: Math.round(p) });
    };

    try {
      await this.prisma.client.node.update({
        where: { id: nodeId },
        data: { status: 'PROCESSING' },
      });
      progress(0);
      const src = join(workDir, 'source');
      const { body } = await this.storage.forRef(version.original).getStream(version.original);
      await pipeline(body, createWriteStream(src));

      const info = await probe(this.tools, src);
      const ladder = buildLadder(info.width, info.height);
      const key = randomBytes(16);
      const iv = randomBytes(16);
      const outDir = join(workDir, 'hls');
      await transcodeHls(this.tools, {
        src,
        outDir,
        workDir,
        ladder,
        hasAudio: info.hasAudio,
        key,
        iv,
        durationSec: info.durationSec,
        onProgress: progress,
      });

      const posterPath = join(workDir, 'poster.jpg');
      const thumbPath = join(workDir, 'thumb.webp');
      const spritePath = join(workDir, 'sprite.jpg');
      await extractPoster(this.tools, src, posterPath, info.durationSec);
      await sharp(posterPath)
        .resize(320, 320, { fit: 'cover' })
        .webp({ quality: 75 })
        .toFile(thumbPath);
      const spriteVtt = await buildSprite(this.tools, src, spritePath, info);

      written.push({ container: bucket, key: prefix });
      const files = await listFiles(outDir);
      let hlsBytes = 0n;
      for (let i = 0; i < files.length; i += UPLOAD_PARALLEL) {
        await Promise.all(
          files.slice(i, i + UPLOAD_PARALLEL).map(async (f) => {
            const ext = f.slice(f.lastIndexOf('.') + 1);
            await this.storage.bucket('hls').putFile(prefix + relative(outDir, f), f, {
              contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
            });
            const { size } = await stat(f);
            hlsBytes += BigInt(size);
          }),
        );
      }
      const put = async (
        path: string,
        name: string,
        mime: string,
        kind: BlobKind,
      ): Promise<NewBlob> => {
        const k = `${prefix.slice(0, -1)}-${name}`;
        await this.storage.bucket('thumbnails').putFile(k, path, { contentType: mime });
        written.push({ container: thumbBucket, key: k });
        return {
          kind,
          container: thumbBucket,
          key: k,
          sizeBytes: BigInt((await stat(path)).size),
          mime,
        };
      };
      const extra = [
        await put(posterPath, 'poster.jpg', 'image/jpeg', 'POSTER'),
        await put(thumbPath, 'thumb.webp', 'image/webp', 'THUMBNAIL'),
        await put(spritePath, 'sprite.jpg', 'image/jpeg', 'SPRITE'),
      ];

      const renditions = ladder.map((r) => ({
        name: r.name,
        width: r.width,
        height: r.height,
        bandwidth: (r.videoKbps + (info.hasAudio ? r.audioKbps : 0)) * 1000,
        playlist: `${r.name}/index.m3u8`,
      }));

      const done = await this.prisma.client.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM nodes WHERE id = ${nodeId}::uuid FOR UPDATE`;
        if (!row) return false;
        const current = await tx.fileInfo.findUnique({
          where: { nodeId },
          select: { currentVersionId: true },
        });
        if (current?.currentVersionId !== versionId) return false;
        const make = (b: NewBlob) => tx.blob.create({ data: { nodeId, provider: 'S3', ...b } });
        const hls = await make({
          kind: 'HLS',
          container: bucket,
          key: prefix,
          sizeBytes: hlsBytes,
          mime: 'application/vnd.apple.mpegurl',
        });
        const [poster, thumb, sprite] = await Promise.all(extra.map(make));
        const old = await tx.video.findUnique({ where: { nodeId } });
        const oldVersion = await tx.fileVersion.findUnique({
          where: { id: versionId },
          select: { thumbnailBlobId: true },
        });
        const data = {
          versionId,
          durationSec: info.durationSec,
          width: info.width,
          height: info.height,
          renditions,
          hlsBlobId: hls.id,
          posterBlobId: poster!.id,
          spriteBlobId: sprite!.id,
          spriteVtt,
          keyEncrypted: new Uint8Array(sealVideoKey(key, this.config.VIDEO_MASTER_KEY)),
          transcodedAt: new Date(),
        };
        await tx.video.upsert({ where: { nodeId }, create: { nodeId, ...data }, update: data });
        await tx.fileVersion.update({
          where: { id: versionId },
          data: { thumbnailBlobId: thumb!.id },
        });
        const stale = [
          old?.hlsBlobId,
          old?.posterBlobId,
          old?.spriteBlobId,
          oldVersion?.thumbnailBlobId,
        ].filter((id): id is string => Boolean(id));
        if (stale.length) await tx.blob.deleteMany({ where: { id: { in: stale } } });
        await tx.fileInfo.upsert({
          where: { nodeId },
          create: { nodeId, currentVersionId: versionId },
          update: { processingError: null },
        });
        await tx.node.update({ where: { id: nodeId }, data: { status: 'READY' } });
        return true;
      });
      if (!done) {
        await this.cleanup(written);
        return { skipped: 'node deleted or version replaced' };
      }
      await this.events.publish({ nodeId, status: 'READY', versionId, progress: 100 });
      await this.notifyUploader(nodeId, versionId, 'video.ready', {
        durationSec: Math.round(info.durationSec),
      });
      this.logger.log(
        `Transcoded ${nodeId} (${ladder.map((r) => r.name).join('/')}, ${Math.round(info.durationSec)}s)`,
      );
      return { renditions: ladder.map((r) => r.name), durationSec: info.durationSec };
    } catch (err) {
      await this.cleanup(written);
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async notifyUploader(
    nodeId: string,
    versionId: string,
    type: string,
    extra: Record<string, string | number>,
  ) {
    try {
      const v = await this.prisma.client.fileVersion.findUnique({
        where: { id: versionId },
        select: { uploadedById: true, node: { select: { name: true, workspaceId: true } } },
      });
      if (!v) return;
      const row = await this.prisma.client.notification.create({
        data: {
          userId: v.uploadedById,
          type,
          payload: { nodeId, nodeName: v.node.name, workspaceId: v.node.workspaceId, ...extra },
        },
      });
      await this.events.notify(row);
    } catch (err) {
      this.logger.warn({ err, nodeId }, 'Could not notify uploader');
    }
  }

  private async isCurrent(nodeId: string, versionId: string) {
    const info = await this.prisma.client.fileInfo.findUnique({
      where: { nodeId },
      select: { currentVersionId: true },
    });
    return info?.currentVersionId === versionId;
  }

  private async cleanup(written: Array<{ container: string; key: string }>) {
    await Promise.all(
      written.map((w) =>
        this.storage
          .forRef({ provider: 'S3' })
          .delete({ provider: 'S3', ...w })
          .catch(() => undefined),
      ),
    );
  }
}
