import { randomUUID } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  type Part,
  type S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { UploadSession } from '@luna/db';
import {
  JOBS,
  type ProcessUploadJob,
  QUEUES,
  ALLOWED_EXTENSIONS,
  ruleForFileName,
} from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentAccessService } from '../content/content-access.service.js';
import { nameKey } from '../content/node-names.js';
import { NodesService } from '../content/nodes.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { BUCKETS, type Buckets, S3, S3_PRESIGN } from '../infra/s3/s3.module.js';
import { NodeEventsService } from './node-events.service.js';
import type { CreateUploadBody, PartsQuery } from './uploads.schemas.js';

const MB = 1024 * 1024;
/** Kích thước mỗi part (S3 tối thiểu 5 MB, tối đa 10.000 part → 16 MB đủ cho file 156 GB). */
export const PART_SIZE = 16 * MB;
const PART_URL_TTL_SEC = 3600;
const PARTS_PER_BATCH = 100;
/** Upload bỏ dở quá hạn này bị job dọn dẹp hủy (PLAN Phase 3). */
export const UPLOAD_TTL_HOURS = 24;

/**
 * Upload multipart thẳng lên bucket tmp bằng URL ký sẵn (SPEC §7.7): file không đi qua API,
 * mất mạng thì hỏi lại các part đã nhận rồi gửi tiếp. Hoàn tất → worker kiểm tra và xử lý.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly nodes: NodesService,
    private readonly audit: AuditService,
    private readonly events: NodeEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(S3_PRESIGN) private readonly presigner: S3Client,
    @Inject(BUCKETS) private readonly buckets: Buckets,
    @InjectQueue(QUEUES.FILE_PROCESS) private readonly fileQueue: Queue,
  ) {}

  async create(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateUploadBody,
    ctx: RequestContext,
  ) {
    this.checkFile(body);

    let nodeId: string;
    if (body.replaceNodeId) {
      const node = await this.access.requireNode(user, body.replaceNodeId, 'EDITOR');
      if (node.workspaceId !== workspaceId) throw AppError.notFound('Item not found');
      if (node.type !== body.kind) {
        throw AppError.validation(`New version must be a ${node.type.toLowerCase()}`);
      }
      const busy = await this.prisma.client.node.findUnique({
        where: { id: node.id },
        select: { status: true, uploads: { where: { status: 'PENDING' }, select: { id: true } } },
      });
      if (busy?.status === 'UPLOADING' || busy?.status === 'PROCESSING' || busy?.uploads.length) {
        throw AppError.conflict('This file is still being uploaded or processed');
      }
      nodeId = node.id;
    } else {
      const parentId = body.parentId ?? null;
      await this.requireContainer(user, workspaceId, parentId);
      try {
        const node = await this.prisma.client.node.create({
          data: {
            workspaceId,
            parentId,
            type: body.kind,
            name: body.fileName,
            nameNormalized: nameKey(body.fileName),
            status: 'UPLOADING',
            createdById: user.id,
            updatedById: user.id,
          },
        });
        nodeId = node.id;
      } catch (err) {
        throw await this.nodes.mapNameConflict(err, workspaceId, parentId, body.fileName);
      }
    }

    const id = randomUUID();
    const tmpKey = `uploads/${id}`;
    const multipart = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.buckets.tmp, Key: tmpKey }),
    );
    const partCount = Math.max(1, Math.ceil(body.size / PART_SIZE));
    const session = await this.prisma.client.uploadSession.create({
      data: {
        id,
        nodeId,
        workspaceId,
        s3UploadId: multipart.UploadId!,
        tmpKey,
        fileName: body.fileName,
        sizeBytes: BigInt(body.size),
        partSize: PART_SIZE,
        partCount,
        mimeDeclared: body.mime,
        isNewVersion: Boolean(body.replaceNodeId),
        createdById: user.id,
        expiresAt: new Date(Date.now() + UPLOAD_TTL_HOURS * 3600_000),
      },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'upload.start',
      targetType: 'node',
      targetId: nodeId,
      workspaceId,
      metadata: {
        fileName: body.fileName,
        size: body.size,
        kind: body.kind,
        newVersion: Boolean(body.replaceNodeId),
      },
      ctx,
    });
    return {
      ...this.toDto(session, body.kind),
      parts: await this.signParts(session, 1, Math.min(partCount, PARTS_PER_BATCH)),
    };
  }

  async status(user: AuthenticatedUser, uploadId: string) {
    const session = await this.requireOwn(user, uploadId);
    const uploaded = session.status === 'PENDING' ? await this.listParts(session) : [];
    return {
      ...this.toDto(session, await this.kindOf(session.nodeId)),
      uploadedParts: uploaded.map((p) => ({
        partNumber: p.PartNumber!,
        size: p.Size ?? 0,
        etag: p.ETag ?? '',
      })),
      uploadedBytes: uploaded.reduce((sum, p) => sum + (p.Size ?? 0), 0),
    };
  }

  async parts(user: AuthenticatedUser, uploadId: string, q: PartsQuery) {
    const session = await this.requirePending(user, uploadId);
    const to = Math.min(q.to ?? q.from + PARTS_PER_BATCH - 1, session.partCount);
    if (q.from > session.partCount || to < q.from) {
      throw AppError.validation(`Part numbers must be between 1 and ${session.partCount}`);
    }
    if (to - q.from + 1 > PARTS_PER_BATCH) {
      throw AppError.validation(`At most ${PARTS_PER_BATCH} parts per request`);
    }
    return { parts: await this.signParts(session, q.from, to) };
  }

  /**
   * Hoàn tất: đối chiếu với các part S3 thực sự nhận được (không tin số liệu client),
   * ghép file, rồi giao cho worker. Gọi lại khi đã hoàn tất thì trả kết quả cũ.
   */
  async complete(user: AuthenticatedUser, uploadId: string, ctx: RequestContext) {
    const existing = await this.requireOwn(user, uploadId);
    if (existing.status === 'COMPLETED') {
      return this.toDto(existing, await this.kindOf(existing.nodeId));
    }
    const session = await this.requirePending(user, uploadId);
    // Quyền có thể đã bị thu hồi trong lúc đang tải.
    const node = await this.access.requireNode(user, session.nodeId, 'EDITOR');

    const parts = await this.listParts(session);
    const received = new Set(parts.map((p) => p.PartNumber));
    const missing: number[] = [];
    for (let n = 1; n <= session.partCount && missing.length < 20; n++) {
      if (!received.has(n)) missing.push(n);
    }
    if (missing.length) {
      throw AppError.validation('Some parts have not been uploaded yet', { missingParts: missing });
    }
    const total = parts.reduce((sum, p) => sum + (p.Size ?? 0), 0);
    if (BigInt(total) !== session.sizeBytes || parts.length !== session.partCount) {
      throw AppError.validation('Uploaded size does not match the declared size', {
        declared: Number(session.sizeBytes),
        received: total,
      });
    }

    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.buckets.tmp,
        Key: session.tmpKey,
        UploadId: session.s3UploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.PartNumber! - b.PartNumber!)
            .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
        },
      }),
    );
    const [done] = await this.prisma.client.$transaction([
      this.prisma.client.uploadSession.update({
        where: { id: uploadId },
        data: { status: 'COMPLETED' },
      }),
      this.prisma.client.node.update({
        where: { id: session.nodeId },
        data: { status: 'PROCESSING', updatedById: user.id },
      }),
    ]);
    await this.fileQueue.add(JOBS.PROCESS_UPLOAD, { uploadId } satisfies ProcessUploadJob, {
      jobId: `upload-${uploadId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    await this.events.publish({ nodeId: session.nodeId, status: 'PROCESSING' });
    await this.audit.log({
      actorId: user.id,
      action: 'file.upload',
      targetType: 'node',
      targetId: session.nodeId,
      workspaceId: node.workspaceId,
      metadata: {
        name: node.name,
        fileName: session.fileName,
        size: Number(session.sizeBytes),
        newVersion: session.isNewVersion,
      },
      ctx,
    });
    return this.toDto(done, node.type as 'FILE' | 'VIDEO');
  }

  /** Hủy: bỏ các part đã gửi; nếu là file mới thì xóa luôn mục đang chờ. */
  async abort(user: AuthenticatedUser, uploadId: string, ctx: RequestContext) {
    const session = await this.requirePending(user, uploadId);
    await this.abortSession(session);
    await this.audit.log({
      actorId: user.id,
      action: 'upload.abort',
      targetType: 'node',
      targetId: session.nodeId,
      workspaceId: session.workspaceId,
      metadata: { fileName: session.fileName },
      ctx,
    });
  }

  async abortSession(session: UploadSession) {
    await this.s3
      .send(
        new AbortMultipartUploadCommand({
          Bucket: this.buckets.tmp,
          Key: session.tmpKey,
          UploadId: session.s3UploadId,
        }),
      )
      .catch((err: { name?: string }) => {
        if (err.name !== 'NoSuchUpload') throw err;
      });
    await this.prisma.client.uploadSession.update({
      where: { id: session.id },
      data: { status: 'ABORTED' },
    });
    if (!session.isNewVersion) {
      await this.prisma.client.node.deleteMany({
        where: { id: session.nodeId, status: 'UPLOADING' },
      });
    }
  }

  // ---------------------------------------------------------------- Helpers

  private checkFile(body: CreateUploadBody) {
    const rule = ruleForFileName(body.fileName);
    if (!rule) {
      throw AppError.unsupportedType('This file type is not allowed', {
        allowedExtensions: ALLOWED_EXTENSIONS,
      });
    }
    if ((rule.category === 'video') !== (body.kind === 'VIDEO')) {
      throw AppError.validation(
        body.kind === 'VIDEO'
          ? 'Only video files can be uploaded as VIDEO'
          : 'Video files must be uploaded with kind VIDEO',
      );
    }
    const maxMb =
      body.kind === 'VIDEO' ? this.config.UPLOAD_MAX_VIDEO_MB : this.config.UPLOAD_MAX_FILE_MB;
    if (body.size > maxMb * MB) {
      throw AppError.tooLarge(`File is larger than ${maxMb} MB`, { maxBytes: maxMb * MB });
    }
  }

  private async requireContainer(
    user: AuthenticatedUser,
    workspaceId: string,
    parentId: string | null,
  ) {
    if (!parentId) {
      await this.access.requireMember(user, workspaceId, 'EDITOR');
      return;
    }
    const parent = await this.access.requireNode(user, parentId, 'EDITOR');
    if (parent.workspaceId !== workspaceId) throw AppError.notFound('Item not found');
    if (parent.type !== 'FOLDER') throw AppError.validation('parentId must be a folder');
  }

  /** Chỉ người tạo upload mới thấy nó (người khác nhận 404). */
  private async requireOwn(user: AuthenticatedUser, uploadId: string) {
    const session = await this.prisma.client.uploadSession.findUnique({ where: { id: uploadId } });
    if (!session || session.createdById !== user.id) throw AppError.notFound('Upload not found');
    return session;
  }

  private async requirePending(user: AuthenticatedUser, uploadId: string) {
    const session = await this.requireOwn(user, uploadId);
    if (session.status !== 'PENDING') {
      throw AppError.conflict(`Upload is already ${session.status.toLowerCase()}`);
    }
    if (session.expiresAt < new Date()) throw AppError.conflict('Upload has expired');
    return session;
  }

  private async signParts(session: UploadSession, from: number, to: number) {
    const parts: { partNumber: number; url: string }[] = [];
    for (let partNumber = from; partNumber <= to; partNumber++) {
      const url = await getSignedUrl(
        this.presigner,
        new UploadPartCommand({
          Bucket: this.buckets.tmp,
          Key: session.tmpKey,
          UploadId: session.s3UploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: PART_URL_TTL_SEC },
      );
      parts.push({ partNumber, url });
    }
    return parts;
  }

  private async listParts(session: UploadSession): Promise<Part[]> {
    const parts: Part[] = [];
    let marker: string | undefined;
    for (;;) {
      const res = await this.s3.send(
        new ListPartsCommand({
          Bucket: this.buckets.tmp,
          Key: session.tmpKey,
          UploadId: session.s3UploadId,
          PartNumberMarker: marker,
        }),
      );
      parts.push(...(res.Parts ?? []));
      if (!res.IsTruncated) return parts;
      marker = res.NextPartNumberMarker;
    }
  }

  private async kindOf(nodeId: string): Promise<'FILE' | 'VIDEO'> {
    const node = await this.prisma.client.node.findUnique({
      where: { id: nodeId },
      select: { type: true },
    });
    return node?.type === 'VIDEO' ? 'VIDEO' : 'FILE';
  }

  private toDto(s: UploadSession, kind: 'FILE' | 'VIDEO') {
    return {
      uploadId: s.id,
      nodeId: s.nodeId,
      fileName: s.fileName,
      size: Number(s.sizeBytes),
      kind,
      isNewVersion: s.isNewVersion,
      status: s.status,
      partSize: s.partSize,
      partCount: s.partCount,
      expiresAt: s.expiresAt,
    };
  }
}
