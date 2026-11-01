import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Prisma } from '@luna/db';
import { ObjectStore } from '@luna/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import type { AdminVideosQuery } from './videos.schemas.js';

const LINK_TTL_SEC = 60;

@Injectable()
export class AdminVideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ObjectStore,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async list(q: AdminVideosQuery) {
    const rows = await this.prisma.client.node.findMany({
      where: {
        type: 'VIDEO',
        deletedAt: null,
        workspace: { deletedAt: null },
        ...(q.q ? { name: { contains: q.q, mode: Prisma.QueryMode.insensitive } } : {}),
      },
      include: {
        workspace: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        video: { select: { durationSec: true, viewCount: true } },
        file: {
          select: { currentVersion: { select: { original: { select: { sizeBytes: true } } } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return rows.map((n) => ({
      id: n.id,
      name: n.name,
      status: n.status,
      workspace: n.workspace,
      size: n.file?.currentVersion ? Number(n.file.currentVersion.original.sizeBytes) : null,
      durationSec: n.video?.durationSec ?? null,
      viewCount: n.video?.viewCount ?? 0,
      createdBy: n.createdBy,
      createdAt: n.createdAt,
    }));
  }

  async createOriginalLink(admin: AuthenticatedUser, nodeId: string) {
    const node = await this.prisma.client.node.findFirst({
      where: { id: nodeId, type: 'VIDEO' },
      select: { id: true, file: { select: { currentVersionId: true } } },
    });
    if (!node?.file?.currentVersionId) throw AppError.notFound('Video has no uploaded original');
    const token = randomBytes(24).toString('base64url');
    await this.redis.set(
      `vdl:${token}`,
      JSON.stringify({ adminId: admin.id, nodeId }),
      'EX',
      LINK_TTL_SEC,
    );
    return {
      url: `/api/v1/downloads/video/${token}`,
      expiresAt: new Date(Date.now() + LINK_TTL_SEC * 1000),
    };
  }

  async redeemOriginalLink(
    token: string,
    ctx: RequestContext,
  ): Promise<{ body: Readable; size: number; mime: string; fileName: string }> {
    const raw = await this.redis.getdel(`vdl:${token}`);
    if (!raw) throw AppError.notFound('Download link is invalid or has expired');
    const { adminId, nodeId } = JSON.parse(raw) as { adminId: string; nodeId: string };
    const admin = await this.prisma.client.user.findUnique({
      where: { id: adminId },
      select: { isSystemAdmin: true, status: true },
    });
    if (!admin?.isSystemAdmin || admin.status !== 'ACTIVE')
      throw AppError.notFound('Download link is invalid or has expired');
    const node = await this.prisma.client.node.findUniqueOrThrow({
      where: { id: nodeId },
      select: {
        name: true,
        workspaceId: true,
        file: { select: { currentVersion: { include: { original: true } } } },
      },
    });
    const version = node.file?.currentVersion;
    if (!version) throw AppError.notFound('Video has no uploaded original');
    const { body } = await this.store.getStream(version.original);
    await this.audit.log({
      actorId: adminId,
      action: 'video.original_access',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: {
        name: node.name,
        versionNo: version.versionNo,
        size: Number(version.original.sizeBytes),
      },
      ctx,
    });
    return {
      body,
      size: Number(version.original.sizeBytes),
      mime: version.original.mime,
      fileName: version.fileName,
    };
  }
}
