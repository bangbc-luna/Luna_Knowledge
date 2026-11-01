import { randomUUID } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  type Part,
} from '@aws-sdk/client-s3';
import type { UploadSession } from '@luna/db';
import {
  enqueueFileJob,
  type JobQueue,
  ObjectStore,
  QUEUES,
  ALLOWED_EXTENSIONS,
  ruleForFileName,
} from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentAccessService } from '../content/content-access.service.js';
import { nameKey } from '../content/node-names.js';
import { NodesService } from '../content/nodes.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { NodeEventsService } from './node-events.service.js';
import type { CreateUploadBody, PartsQuery } from './uploads.schemas.js';

const MB = 1024 * 1024;
export const PART_SIZE = 16 * MB;
const PART_URL_TTL_SEC = 3600;
const PARTS_PER_BATCH = 100;
export const UPLOAD_TTL_HOURS = 24;

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly nodes: NodesService,
    private readonly audit: AuditService,
    private readonly events: NodeEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: ObjectStore,
    @InjectQueue(QUEUES.FILE_PROCESS) private readonly fileQueue: JobQueue<'file-process'>,
  ) {}

  async create(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateUploadBody,
    ctx: RequestContext,
  ) {
    this.checkFile(body);

    let nodeId: string;
    let createdNode = false;
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
      const name = body.title ?? body.fileName;
      const section = body.kind === 'VIDEO' ? 'VIDEOS' : 'DOCS';
      await this.nodes.requireContainer(user, workspaceId, parentId, section);
      try {
        const node = await this.nodes.withTreeLock(workspaceId, (tx) =>
          tx.node.create({
            data: {
              workspaceId,
              parentId,
              section,
              type: body.kind,
              name,
              nameNormalized: nameKey(name),
              description: body.description ?? null,
              status: 'UPLOADING',
              createdById: user.id,
              updatedById: user.id,
            },
          }),
        );
        nodeId = node.id;
        createdNode = true;
      } catch (err) {
        throw await this.nodes.mapNameConflict(
          err,
          workspaceId,
          parentId,
          name,
          undefined,
          section,
        );
      }
    }

    const id = randomUUID();
    const tmpKey = `uploads/${id}`;
    const partCount = Math.max(1, Math.ceil(body.size / PART_SIZE));
    let s3UploadId: string | undefined;
    let session: UploadSession;
    try {
      const multipart = await this.store.s3.send(
        new CreateMultipartUploadCommand({ Bucket: this.store.buckets.tmp, Key: tmpKey }),
      );
      s3UploadId = multipart.UploadId;
      session = await this.prisma.client.uploadSession.create({
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
    } catch (err) {
      if (s3UploadId) {
        await this.store.s3
          .send(
            new AbortMultipartUploadCommand({
              Bucket: this.store.buckets.tmp,
              Key: tmpKey,
              UploadId: s3UploadId,
            }),
          )
          .catch((cleanupErr: unknown) => {
            this.logger.warn(
              { err: cleanupErr, uploadId: id },
              'Failed to abort the multipart upload after a failed upload start',
            );
          });
      }
      if (createdNode) {
        await this.prisma.client.node
          .deleteMany({ where: { id: nodeId, status: 'UPLOADING' } })
          .catch((cleanupErr: unknown) => {
            this.logger.warn(
              { err: cleanupErr, nodeId },
              'Failed to remove the placeholder node after a failed upload start',
            );
          });
      }
      throw err;
    }
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

  async complete(user: AuthenticatedUser, uploadId: string, ctx: RequestContext) {
    const existing = await this.requireOwn(user, uploadId);
    if (existing.status === 'COMPLETED') {
      return this.toDto(existing, await this.kindOf(existing.nodeId));
    }
    const session = await this.requirePending(user, uploadId);
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

    await this.store.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.store.buckets.tmp,
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
    await enqueueFileJob(this.fileQueue, 'process-upload', { uploadId }, `upload-${uploadId}`);
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
    await this.store.s3
      .send(
        new AbortMultipartUploadCommand({
          Bucket: this.store.buckets.tmp,
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
      const url = await this.store.presignUploadPart(
        { container: this.store.buckets.tmp, key: session.tmpKey },
        session.s3UploadId,
        partNumber,
        PART_URL_TTL_SEC,
      );
      parts.push({ partNumber, url });
    }
    return parts;
  }

  private async listParts(session: UploadSession): Promise<Part[]> {
    const parts: Part[] = [];
    let marker: string | undefined;
    for (;;) {
      const res = await this.store.s3.send(
        new ListPartsCommand({
          Bucket: this.store.buckets.tmp,
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
