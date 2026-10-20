import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Prisma } from '@luna/db';
import { JOBS, QUEUES, type RegenerateJob } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { ContentAccessService } from '../content/content-access.service.js';
import { NodeDtoService } from '../content/node-dto.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import type { FileVersionDto } from './files.schemas.js';
import { NodeEventsService } from './node-events.service.js';
import { StorageService } from './storage.service.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const DOWNLOAD_TOKEN_TTL_SEC = 60;

const versionInclude = {
  original: true,
  preview: true,
  thumbnail: true,
  uploadedBy: { select: userSummary },
} satisfies Prisma.FileVersionInclude;
type VersionRow = Prisma.FileVersionGetPayload<{ include: typeof versionInclude }>;

interface DownloadGrant {
  userId: string;
  nodeId: string;
  versionId: string;
}

/** Xem trước, tải về, phiên bản của file (SPEC §7.8, FILE-1..4). */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly dto: NodeDtoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: NodeEventsService,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(QUEUES.FILE_PROCESS) private readonly fileQueue: Queue,
  ) {}

  async detail(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireFile(user, nodeId, 'VIEWER');
    await this.audit.logView(user.id, node, ctx);
    const info = await this.prisma.client.fileInfo.findUnique({
      where: { nodeId },
      include: { currentVersion: { include: versionInclude } },
    });
    const versionCount = await this.prisma.client.fileVersion.count({ where: { nodeId } });
    return {
      node: await this.dto.one(user.id, nodeId),
      currentVersion: info?.currentVersion ? this.toVersionDto(info.currentVersion, true) : null,
      versionCount,
      processingError: info?.processingError ?? null,
      canDownload: node.type === 'FILE',
    };
  }

  async versions(user: AuthenticatedUser, nodeId: string): Promise<FileVersionDto[]> {
    await this.requireFile(user, nodeId, 'VIEWER');
    const [info, rows] = await Promise.all([
      this.prisma.client.fileInfo.findUnique({ where: { nodeId } }),
      this.prisma.client.fileVersion.findMany({
        where: { nodeId },
        include: versionInclude,
        orderBy: { versionNo: 'desc' },
      }),
    ]);
    return rows.map((v) => this.toVersionDto(v, v.id === info?.currentVersionId));
  }

  async preview(user: AuthenticatedUser, nodeId: string, versionId?: string) {
    await this.requireFile(user, nodeId, 'VIEWER');
    const version = await this.findVersion(nodeId, versionId);
    if (!version?.preview || version.previewKind === 'none') {
      return { kind: 'none' as const, mime: null, url: null, expiresAt: null };
    }
    const signed = await this.storage.presignGet(version.preview, {
      fileName: previewFileName(version.fileName, version.preview.mime),
      contentType: version.preview.mime,
    });
    return {
      kind: version.previewKind as 'pdf' | 'image' | 'text',
      mime: version.preview.mime,
      ...signed,
    };
  }

  /** URL ký tới thumbnail (controller trả redirect 302). */
  async thumbnailUrl(user: AuthenticatedUser, nodeId: string): Promise<string> {
    await this.requireFile(user, nodeId, 'VIEWER');
    const version = await this.findVersion(nodeId);
    if (!version?.thumbnail) throw AppError.notFound('This file has no thumbnail');
    const { url } = await this.storage.presignGet(version.thumbnail, {
      fileName: 'thumbnail.webp',
      contentType: version.thumbnail.mime,
    });
    return url;
  }

  /** Mở stream file gốc (qua API, không lộ vị trí lưu trữ) và ghi audit `file.download`. */
  async openDownload(
    user: { id: string },
    nodeId: string,
    versionId: string | undefined,
    ctx: RequestContext,
  ): Promise<{ body: Readable; size: number; mime: string; fileName: string }> {
    const node = await this.access.requireNode(user as AuthenticatedUser, nodeId, 'VIEWER');
    this.assertDownloadable(node);
    const version = await this.findVersion(nodeId, versionId);
    if (!version) throw AppError.notFound('This file has no uploaded content yet');
    const { body } = await this.storage.forRef(version.original).getStream(version.original);
    await this.audit.log({
      actorId: user.id,
      action: 'file.download',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, versionNo: version.versionNo, fileName: version.fileName },
      ctx,
    });
    return {
      body,
      size: Number(version.original.sizeBytes),
      mime: version.original.mime,
      fileName: downloadFileName(node.name, version.fileName),
    };
  }

  /**
   * Link tải dùng một lần (60 giây) để trình duyệt tải trực tiếp, không phải nạp cả file vào bộ nhớ
   * bằng fetch. Kiểm tra quyền ngay lúc tạo và kiểm tra lại lúc tải.
   */
  async createDownloadLink(user: AuthenticatedUser, nodeId: string, versionId?: string) {
    const node = await this.requireFile(user, nodeId, 'VIEWER');
    this.assertDownloadable(node);
    const version = await this.findVersion(nodeId, versionId);
    if (!version) throw AppError.notFound('This file has no uploaded content yet');
    const token = randomBytes(24).toString('base64url');
    const grant: DownloadGrant = { userId: user.id, nodeId, versionId: version.id };
    await this.redis.set(`dl:${token}`, JSON.stringify(grant), 'EX', DOWNLOAD_TOKEN_TTL_SEC);
    return {
      url: `/api/v1/downloads/${token}`,
      expiresAt: new Date(Date.now() + DOWNLOAD_TOKEN_TTL_SEC * 1000),
    };
  }

  async redeemDownloadLink(token: string, ctx: RequestContext) {
    const raw = await this.redis.getdel(`dl:${token}`);
    if (!raw) throw AppError.notFound('Download link is invalid or has expired');
    const grant = JSON.parse(raw) as DownloadGrant;
    const user = await this.prisma.client.user.findUnique({
      where: { id: grant.userId },
      select: { id: true, status: true },
    });
    if (user?.status !== 'ACTIVE')
      throw AppError.notFound('Download link is invalid or has expired');
    return this.openDownload(user, grant.nodeId, grant.versionId, ctx);
  }

  async restoreVersion(
    user: AuthenticatedUser,
    nodeId: string,
    versionId: string,
    ctx: RequestContext,
  ) {
    const node = await this.requireFile(user, nodeId, 'EDITOR');
    const version = await this.findVersion(nodeId, versionId);
    if (!version) throw AppError.notFound('Version not found');
    const current = await this.prisma.client.node.findUnique({
      where: { id: nodeId },
      select: { status: true },
    });
    if (current?.status === 'UPLOADING' || current?.status === 'PROCESSING') {
      throw AppError.conflict('This file is still being uploaded or processed');
    }
    await this.prisma.client.$transaction([
      this.prisma.client.fileInfo.update({
        where: { nodeId },
        data: { currentVersionId: version.id, processingError: null },
      }),
      this.prisma.client.node.update({
        where: { id: nodeId },
        data: { status: 'READY', updatedById: user.id },
      }),
    ]);
    await this.audit.log({
      actorId: user.id,
      action: 'file.version_restore',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, versionNo: version.versionNo },
      ctx,
    });
    return this.detail(user, nodeId, ctx);
  }

  /** Tạo lại preview/thumbnail/chữ trích từ file gốc (khi lỗi hoặc mất dữ liệu MinIO). */
  async regenerate(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireFile(user, nodeId, 'EDITOR');
    const version = await this.findVersion(nodeId);
    if (!version) throw AppError.notFound('This file has no uploaded content yet');
    await this.fileQueue.add(
      JOBS.REGENERATE,
      { nodeId, versionId: version.id } satisfies RegenerateJob,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    await this.prisma.client.node.update({ where: { id: nodeId }, data: { status: 'PROCESSING' } });
    await this.events.publish({ nodeId, status: 'PROCESSING' });
    await this.audit.log({
      actorId: user.id,
      action: 'file.regenerate',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, versionNo: version.versionNo },
      ctx,
    });
  }

  async events$(user: AuthenticatedUser, nodeId: string) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER');
    const row = await this.prisma.client.node.findUnique({
      where: { id: nodeId },
      select: { status: true, file: { select: { processingError: true, currentVersionId: true } } },
    });
    return {
      initial: {
        nodeId: node.id,
        status: row!.status,
        versionId: row!.file?.currentVersionId ?? undefined,
        error: row!.file?.processingError ?? undefined,
      },
      stream: this.events.stream(nodeId),
    };
  }

  /** Dung lượng một workspace (không có quota ở MVP, chỉ để theo dõi). */
  async storageStats(user: AuthenticatedUser, workspaceId: string) {
    await this.access.requireMember(user, workspaceId, 'VIEWER');
    const [row] = await this.prisma.client.$queryRaw<
      { total: bigint; original: bigint; trash: bigint; files: bigint }[]
    >`
      SELECT COALESCE(sum(b.size_bytes), 0)::bigint AS total,
             COALESCE(sum(b.size_bytes) FILTER (WHERE b.kind = 'ORIGINAL'), 0)::bigint AS original,
             COALESCE(sum(b.size_bytes) FILTER (WHERE n.deleted_at IS NOT NULL), 0)::bigint AS trash,
             count(DISTINCT n.id) FILTER (WHERE n.deleted_at IS NULL)::bigint AS files
        FROM blobs b JOIN nodes n ON n.id = b.node_id
       WHERE n.workspace_id = ${workspaceId}::uuid`;
    return {
      totalBytes: Number(row!.total),
      originalBytes: Number(row!.original),
      derivedBytes: Number(row!.total - row!.original),
      fileCount: Number(row!.files),
      trashBytes: Number(row!.trash),
    };
  }

  // ---------------------------------------------------------------- Helpers

  private async requireFile(user: AuthenticatedUser, nodeId: string, min: 'VIEWER' | 'EDITOR') {
    const node = await this.access.requireNode(user, nodeId, min);
    if (node.type !== 'FILE' && node.type !== 'VIDEO') throw AppError.notFound('File not found');
    return node;
  }

  private assertDownloadable(node: { type: string }) {
    if (node.type === 'VIDEO') {
      throw AppError.forbidden('Videos can only be watched, not downloaded');
    }
    if (node.type !== 'FILE') throw AppError.notFound('File not found');
  }

  private async findVersion(nodeId: string, versionId?: string): Promise<VersionRow | null> {
    if (versionId) {
      return this.prisma.client.fileVersion.findFirst({
        where: { id: versionId, nodeId },
        include: versionInclude,
      });
    }
    const info = await this.prisma.client.fileInfo.findUnique({
      where: { nodeId },
      include: { currentVersion: { include: versionInclude } },
    });
    return info?.currentVersion ?? null;
  }

  private toVersionDto(v: VersionRow, isCurrent: boolean): FileVersionDto {
    return {
      id: v.id,
      versionNo: v.versionNo,
      fileName: v.fileName,
      size: Number(v.original.sizeBytes),
      mime: v.original.mime,
      sha256: v.original.sha256,
      previewKind: v.previewKind as FileVersionDto['previewKind'],
      hasThumbnail: Boolean(v.thumbnail),
      uploadedBy: v.uploadedBy,
      createdAt: v.createdAt,
      isCurrent,
    };
  }
}

/** Tên khi tải: theo tên mục hiện tại (có thể đã đổi tên), giữ đuôi của file đã tải lên. */
function downloadFileName(nodeName: string, uploadedName: string): string {
  const ext = uploadedName.includes('.') ? uploadedName.slice(uploadedName.lastIndexOf('.')) : '';
  return ext && !nodeName.toLowerCase().endsWith(ext.toLowerCase()) ? nodeName + ext : nodeName;
}

function previewFileName(fileName: string, mime: string): string {
  const base = fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;
  if (mime === 'application/pdf') return `${base}.pdf`;
  if (mime === 'image/webp') return `${base}.webp`;
  return fileName;
}
