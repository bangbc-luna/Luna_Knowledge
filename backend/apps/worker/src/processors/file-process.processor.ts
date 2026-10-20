import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { BlobKind } from '@luna/db';
import {
  type BlobRef,
  FILE_TYPES,
  type FileTypeRule,
  JOBS,
  type ProcessUploadJob,
  QUEUES,
  type RegenerateJob,
} from '@luna/shared';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Job, type Queue, UnrecoverableError } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';
import { PrismaService } from '../infra/prisma.provider.js';
import { NodeEventsPublisher } from '../infra/redis.provider.js';
import { StorageService } from '../infra/storage.provider.js';
import { buildPreviews, type DerivedFile, extractText } from '../processing/derive.js';
import { RejectedFileError, sniffFile } from '../processing/sniff.js';

interface WrittenBlob extends BlobRef {
  kind: BlobKind;
  sizeBytes: bigint;
  mime: string;
  sha256?: string;
}

/**
 * Xử lý file sau khi upload xong (PLAN Phase 3): tải từ bucket tmp, xác định loại thật, tính SHA-256,
 * lưu bản gốc, tạo preview/thumbnail, trích chữ, rồi ghi phiên bản mới. Job chạy lại an toàn:
 * id phiên bản = id upload nên lần chạy sau thấy đã xong thì chỉ dọn tmp.
 */
@Processor(QUEUES.FILE_PROCESS, { concurrency: 2 })
export class FileProcessProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(FileProcessProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: NodeEventsPublisher,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @InjectQueue(QUEUES.VIDEO_TRANSCODE) private readonly videoQueue: Queue,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.concurrency = this.config.FILE_PROCESS_CONCURRENCY;
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOBS.PROCESS_UPLOAD:
        return this.processUpload((job.data as ProcessUploadJob).uploadId);
      case JOBS.REGENERATE:
        return this.regenerate(job.data as RegenerateJob);
      default:
        throw new Error(`Unknown job "${job.name}" on queue ${QUEUES.FILE_PROCESS}`);
    }
  }

  /** Hết số lần thử (hoặc lỗi vĩnh viễn): báo FAILED cho người dùng. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, err: Error) {
    if (!job) return;
    const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!final) return;
    const nodeId =
      job.name === JOBS.REGENERATE
        ? (job.data as RegenerateJob).nodeId
        : (
            await this.prisma.client.uploadSession.findUnique({
              where: { id: (job.data as ProcessUploadJob).uploadId },
              select: { nodeId: true },
            })
          )?.nodeId;
    if (nodeId) await this.markFailed(nodeId, publicMessage(err));
  }

  // ---------------------------------------------------------------- Upload mới

  async processUpload(uploadId: string) {
    const session = await this.prisma.client.uploadSession.findUnique({
      where: { id: uploadId },
      include: { node: { select: { id: true, workspaceId: true, type: true } } },
    });
    if (!session || session.status !== 'COMPLETED') return { skipped: 'no completed upload' };
    const tmp = { Bucket: this.storage.buckets.tmp, Key: session.tmpKey };
    const already = await this.prisma.client.fileVersion.findUnique({ where: { id: uploadId } });
    if (already) {
      await this.storage.s3.send(new DeleteObjectCommand(tmp)).catch(() => undefined);
      return { skipped: 'already processed' };
    }

    const node = session.node;
    const kind = node.type === 'VIDEO' ? 'VIDEO' : 'FILE';
    const workDir = await mkdtemp(join(tmpdir(), 'luna-file-'));
    const written: WrittenBlob[] = [];
    try {
      const local = join(workDir, 'original');
      const obj = await this.storage.s3.send(new GetObjectCommand(tmp));
      const { sha256, size } = await saveWithHash(obj.Body as Readable, local);

      let rule: FileTypeRule;
      try {
        rule = await sniffFile(local, session.fileName, kind);
      } catch (err) {
        if (err instanceof RejectedFileError) {
          await this.storage.s3.send(new DeleteObjectCommand(tmp)).catch(() => undefined);
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }

      const original = await this.storage.originals.putFile(
        `ws/${node.workspaceId}/${node.id}/${uploadId}`,
        local,
        { contentType: rule.mime, fileName: session.fileName },
      );
      written.push({ ...original, kind: 'ORIGINAL', sizeBytes: size, mime: rule.mime, sha256 });

      const derived = await this.derive(local, session.fileName, rule, workDir, node.id, uploadId);
      written.push(...derived.blobs);

      const created = await this.prisma.client.$transaction(async (tx) => {
        const exists = await tx.node.findUnique({ where: { id: node.id }, select: { id: true } });
        if (!exists) return false; // Đã bị xóa vĩnh viễn trong lúc xử lý.
        const blobs = await Promise.all(
          written.map((b) =>
            tx.blob.create({
              data: {
                nodeId: node.id,
                kind: b.kind,
                provider: b.provider,
                container: b.container,
                key: b.key,
                sizeBytes: b.sizeBytes,
                mime: b.mime,
                sha256: b.sha256,
              },
            }),
          ),
        );
        const byKind = (k: BlobKind) => blobs.find((b) => b.kind === k)?.id;
        const last = await tx.fileVersion.aggregate({
          where: { nodeId: node.id },
          _max: { versionNo: true },
        });
        await tx.fileVersion.create({
          data: {
            id: uploadId,
            nodeId: node.id,
            versionNo: (last._max.versionNo ?? 0) + 1,
            fileName: session.fileName,
            originalBlobId: byKind('ORIGINAL')!,
            previewBlobId: byKind('PREVIEW'),
            thumbnailBlobId: byKind('THUMBNAIL'),
            previewKind: derived.previewKind,
            uploadedById: session.createdById,
          },
        });
        const info = {
          currentVersionId: uploadId,
          extractedText: derived.text,
          extractedAt: new Date(),
          processingError: derived.warnings.join('; ') || null,
        };
        await tx.fileInfo.upsert({
          where: { nodeId: node.id },
          create: { nodeId: node.id, ...info },
          update: info,
        });
        await tx.node.update({
          where: { id: node.id },
          // Video còn chờ transcode HLS (Phase 4).
          data: {
            status: kind === 'VIDEO' ? 'PROCESSING' : 'READY',
            updatedById: session.createdById,
          },
        });
        return true;
      });

      if (!created) {
        await this.deleteWritten(written);
        return { skipped: 'node deleted' };
      }
      await this.storage.s3.send(new DeleteObjectCommand(tmp)).catch(() => undefined);
      if (kind === 'VIDEO') {
        await this.videoQueue.add(
          'transcode',
          { nodeId: node.id, versionId: uploadId },
          { jobId: `transcode-${uploadId}`, removeOnComplete: 100, removeOnFail: 500 },
        );
      }
      await this.events.publish({
        nodeId: node.id,
        status: kind === 'VIDEO' ? 'PROCESSING' : 'READY',
        versionId: uploadId,
      });
      this.logger.log(`Processed upload ${uploadId} (${rule.mime}, ${size} bytes)`);
      return {
        versionId: uploadId,
        mime: rule.mime,
        size: Number(size),
        preview: derived.previewKind,
      };
    } catch (err) {
      await this.deleteWritten(written);
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------- Tạo lại bản dẫn xuất

  async regenerate({ nodeId, versionId }: RegenerateJob) {
    const version = await this.prisma.client.fileVersion.findFirst({
      where: { id: versionId, nodeId },
      include: { original: true },
    });
    if (!version) return { skipped: 'version not found' };
    const rule =
      Object.values(FILE_TYPES).find((r) => r.mime === version.original.mime) ??
      (() => {
        throw new UnrecoverableError(`Unknown stored type ${version.original.mime}`);
      })();

    const workDir = await mkdtemp(join(tmpdir(), 'luna-regen-'));
    const written: WrittenBlob[] = [];
    try {
      const local = join(workDir, 'original');
      const { body } = await this.storage.forRef(version.original).getStream(version.original);
      await saveWithHash(body, local);
      const derived = await this.derive(local, version.fileName, rule, workDir, nodeId, versionId);
      written.push(...derived.blobs);

      await this.prisma.client.$transaction(async (tx) => {
        const blobs = await Promise.all(
          written.map((b) =>
            tx.blob.create({
              data: {
                nodeId,
                kind: b.kind,
                provider: b.provider,
                container: b.container,
                key: b.key,
                sizeBytes: b.sizeBytes,
                mime: b.mime,
              },
            }),
          ),
        );
        const oldIds = [version.previewBlobId, version.thumbnailBlobId].filter((id): id is string =>
          Boolean(id),
        );
        await tx.fileVersion.update({
          where: { id: versionId },
          data: {
            previewBlobId: blobs.find((b) => b.kind === 'PREVIEW')?.id ?? null,
            thumbnailBlobId: blobs.find((b) => b.kind === 'THUMBNAIL')?.id ?? null,
            previewKind: derived.previewKind,
          },
        });
        // Xóa blob cũ: trigger đưa object vào hàng đợi dọn (key mới khác key cũ nên không đụng nhau).
        if (oldIds.length) await tx.blob.deleteMany({ where: { id: { in: oldIds } } });
        const info = await tx.fileInfo.findUnique({ where: { nodeId } });
        const isCurrent = info?.currentVersionId === versionId;
        if (isCurrent) {
          await tx.fileInfo.update({
            where: { nodeId },
            data: {
              extractedText: derived.text,
              extractedAt: new Date(),
              processingError: derived.warnings.join('; ') || null,
            },
          });
        }
        await tx.node.update({ where: { id: nodeId }, data: { status: 'READY' } });
      });
      await this.events.publish({ nodeId, status: 'READY', versionId });
      return { versionId, preview: derived.previewKind };
    } catch (err) {
      await this.deleteWritten(written);
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------- Helpers

  /** Preview + thumbnail lên MinIO, cùng chữ trích. Key có hậu tố ngẫu nhiên để tạo lại không ghi đè. */
  private async derive(
    local: string,
    fileName: string,
    rule: FileTypeRule,
    workDir: string,
    nodeId: string,
    versionId: string,
  ) {
    const conv = { gotenbergUrl: this.config.GOTENBERG_URL, tikaUrl: this.config.TIKA_URL };
    const result = await buildPreviews(local, fileName, rule, workDir, conv);
    const suffix = randomBytes(4).toString('hex');
    const blobs: WrittenBlob[] = [];
    const put = async (file: DerivedFile, bucket: 'previews' | 'thumbnails', kind: BlobKind) => {
      const ref = await this.storage
        .bucket(bucket)
        .putFile(`${nodeId}/${versionId}-${suffix}.${file.ext}`, file.path, {
          contentType: file.mime,
        });
      const { size } = await stat(file.path);
      blobs.push({ ...ref, kind, sizeBytes: BigInt(size), mime: file.mime });
    };
    if (result.preview) await put(result.preview, 'previews', 'PREVIEW');
    if (result.thumbnail) await put(result.thumbnail, 'thumbnails', 'THUMBNAIL');

    let text: string | null = null;
    try {
      text = await extractText(local, rule, conv.tikaUrl);
    } catch (err) {
      result.warnings.push(`Text extraction failed: ${(err as Error).message}`);
    }
    return { ...result, blobs, text };
  }

  private async deleteWritten(written: WrittenBlob[]) {
    await Promise.all(
      written.map((b) =>
        this.storage
          .forRef(b)
          .delete(b)
          .catch((err) => this.logger.warn({ err, key: b.key }, 'Failed to clean up object')),
      ),
    );
  }

  private async markFailed(nodeId: string, message: string) {
    try {
      const info = await this.prisma.client.fileInfo.upsert({
        where: { nodeId },
        create: { nodeId, processingError: message },
        update: { processingError: message },
      });
      // Phiên bản mới lỗi thì file vẫn dùng phiên bản cũ.
      const status = info.currentVersionId ? 'READY' : 'FAILED';
      await this.prisma.client.node.update({ where: { id: nodeId }, data: { status } });
      await this.events.publish({ nodeId, status, error: message });
    } catch (err) {
      // Node đã bị xóa vĩnh viễn.
      this.logger.warn({ err, nodeId }, 'Could not mark file as failed');
    }
  }
}

/** Ghi stream ra file, đồng thời tính SHA-256 và kích thước. */
async function saveWithHash(body: Readable, path: string) {
  const hash = createHash('sha256');
  let size = 0n;
  await pipeline(
    body,
    new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        size += BigInt(chunk.length);
        cb(null, chunk);
      },
    }),
    createWriteStream(path),
  );
  return { sha256: hash.digest('hex'), size };
}

/** Lỗi trả cho người dùng: lỗi file không hợp lệ giữ nguyên, lỗi hạ tầng thì nói chung chung. */
function publicMessage(err: Error): string {
  if (err instanceof UnrecoverableError) return err.message;
  return 'Processing failed, please try again later';
}
