import { randomBytes } from 'node:crypto';
import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import type { Readable } from 'node:stream';
import { accessColumns, effectiveRole, Prisma } from '@luna/db';
import { enqueueFileJob, type JobQueue, ObjectStore, QUEUES } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { ContentAccessService, AS_FILE } from '../content/content-access.service.js';
import { NodeDtoService } from '../content/node-dto.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import { PREVIEW_URL } from '../infra/s3/storage-urls.js';
import type { FileVersionDto } from './files.schemas.js';
import { NodeEventsService } from './node-events.service.js';
import { TranscodeQueueService } from './transcode-queue.service.js';

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

const MAX_DUPLICATES = 5;

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly dto: NodeDtoService,
    private readonly store: ObjectStore,
    private readonly audit: AuditService,
    private readonly search: SearchQueueService,
    private readonly events: NodeEventsService,
    private readonly transcodes: TranscodeQueueService,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(QUEUES.FILE_PROCESS) private readonly fileQueue: JobQueue<'file-process'>,
  ) {}

  async detail(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', AS_FILE);
    await this.audit.logView(user.id, node, ctx);
    const info = await this.prisma.client.fileInfo.findUnique({
      where: { nodeId },
      include: { currentVersion: { include: versionInclude } },
    });
    const versionCount = await this.prisma.client.fileVersion.count({ where: { nodeId } });
    const sha256 = info?.currentVersion?.original.sha256;
    return {
      node: await this.dto.one(user.id, nodeId),
      currentVersion: info?.currentVersion ? this.toVersionDto(info.currentVersion, true) : null,
      versionCount,
      processingError: info?.processingError ?? null,
      canDownload: node.type === 'FILE',
      duplicates: sha256 ? await this.duplicates(user.id, nodeId, sha256) : [],
    };
  }

  async duplicateInfo(user: AuthenticatedUser, nodeId: string) {
    await this.access.requireNode(user, nodeId, 'VIEWER', AS_FILE);
    const info = await this.prisma.client.fileInfo.findUnique({
      where: { nodeId },
      include: {
        node: { select: { status: true } },
        currentVersion: { include: { original: true } },
      },
    });
    const sha256 = info?.currentVersion?.original.sha256;
    return {
      status: info?.node.status ?? 'UPLOADING',
      duplicates: sha256 ? await this.duplicates(user.id, nodeId, sha256) : [],
    };
  }

  private async duplicates(userId: string, nodeId: string, sha256: string) {
    const rows = await this.prisma.client.$queryRaw<
      {
        id: string;
        name: string;
        type: 'FILE' | 'VIDEO';
        section: 'DOCS' | 'VIDEOS';
        workspace_id: string;
        workspace_name: string;
        member_role: string | null;
        share_role: string | null;
        user_active: boolean | null;
      }[]
    >(Prisma.sql`
      SELECT * FROM (
      SELECT n.id, n.name, n.type::text AS type, n.section::text AS section,
             n.workspace_id, w.name AS workspace_name, n.created_at, ${accessColumns(userId)}
        FROM blobs b
        JOIN file_versions v ON v.original_blob_id = b.id
        JOIN files f ON f.current_version_id = v.id
        JOIN nodes n ON n.id = f.node_id
        JOIN workspaces w ON w.id = n.workspace_id
       WHERE b.sha256 = ${sha256} AND b.kind = 'ORIGINAL'
         AND n.id <> ${nodeId}::uuid AND n.deleted_at IS NULL AND w.deleted_at IS NULL
      ) d
       WHERE d.member_role IS NOT NULL OR d.share_role IS NOT NULL
       ORDER BY d.created_at
       LIMIT ${MAX_DUPLICATES * 2}`);
    return rows
      .filter((r) => effectiveRole(r))
      .slice(0, MAX_DUPLICATES)
      .map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        section: r.section,
        workspace: { id: r.workspace_id, name: r.workspace_name },
      }));
  }

  async versions(user: AuthenticatedUser, nodeId: string): Promise<FileVersionDto[]> {
    await this.access.requireNode(user, nodeId, 'VIEWER', AS_FILE);
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
    await this.access.requireNode(user, nodeId, 'VIEWER', AS_FILE);
    const version = await this.findVersion(nodeId, versionId);
    if (!version?.preview || version.previewKind === 'none') {
      return { kind: 'none' as const, mime: null, url: null, expiresAt: null };
    }
    const signed = await this.store.presignGet(version.preview, {
      ...PREVIEW_URL,
      contentType: version.preview.mime,
      disposition: {
        type: 'inline',
        fileName: previewFileName(version.fileName, version.preview.mime),
      },
    });
    return {
      kind: version.previewKind as 'pdf' | 'image' | 'text',
      mime: version.preview.mime,
      ...signed,
    };
  }

  async thumbnailUrl(user: AuthenticatedUser, nodeId: string): Promise<string> {
    await this.access.requireNode(user, nodeId, 'VIEWER', AS_FILE);
    const version = await this.findVersion(nodeId);
    if (!version?.thumbnail) throw AppError.notFound('This file has no thumbnail');
    const { url } = await this.store.presignGet(version.thumbnail, {
      ...PREVIEW_URL,
      contentType: version.thumbnail.mime,
      disposition: { type: 'inline', fileName: 'thumbnail.webp' },
    });
    return url;
  }

  async openDownload(
    user: { id: string },
    nodeId: string,
    versionId: string | undefined,
    ctx: RequestContext,
    { inactiveUser }: { inactiveUser?: string } = {},
  ): Promise<{ body: Readable; size: number; mime: string; fileName: string }> {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', { inactiveUser });
    this.assertDownloadable(node);
    const version = await this.findVersion(nodeId, versionId);
    if (!version) throw AppError.notFound('This file has no uploaded content yet');
    const { body } = await this.store.getStream(version.original);
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

  async createDownloadLink(user: AuthenticatedUser, nodeId: string, versionId?: string) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', AS_FILE);
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
    return this.openDownload({ id: grant.userId }, grant.nodeId, grant.versionId, ctx, {
      inactiveUser: 'Download link is invalid or has expired',
    });
  }

  async restoreVersion(
    user: AuthenticatedUser,
    nodeId: string,
    versionId: string,
    ctx: RequestContext,
  ) {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR', AS_FILE);
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
        data: { status: node.type === 'VIDEO' ? 'PROCESSING' : 'READY', updatedById: user.id },
      }),
    ]);
    if (node.type === 'VIDEO') await this.transcodes.enqueue(nodeId, version.id);
    await this.audit.log({
      actorId: user.id,
      action: 'file.version_restore',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, versionNo: version.versionNo },
      ctx,
    });
    await this.search.node(nodeId);
    return this.detail(user, nodeId, ctx);
  }

  async regenerate(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR', AS_FILE);
    const version = await this.findVersion(nodeId);
    if (!version) throw AppError.notFound('This file has no uploaded content yet');
    const current = await this.prisma.client.node.findUnique({
      where: { id: nodeId },
      select: { status: true },
    });
    if (current?.status === 'UPLOADING' || current?.status === 'PROCESSING') {
      throw AppError.conflict('This file is still being uploaded or processed');
    }
    if (node.type === 'VIDEO') {
      await this.transcodes.enqueue(nodeId, version.id);
    } else {
      await enqueueFileJob(this.fileQueue, 'regenerate', { nodeId, versionId: version.id });
    }
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
    await this.search.node(nodeId);
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

  async storageStats(user: AuthenticatedUser, workspaceId: string) {
    await this.access.requireMember(user, workspaceId);
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
