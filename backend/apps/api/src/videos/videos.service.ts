import { ObjectStore } from '@luna/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentAccessService, AS_VIDEO } from '../content/content-access.service.js';
import { NodeDtoService } from '../content/node-dto.service.js';
import { NodeEventsService } from '../files/node-events.service.js';
import { TranscodeQueueService } from '../files/transcode-queue.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import { PREVIEW_URL } from '../infra/s3/storage-urls.js';
import { HlsSessions } from './hls-sessions.service.js';

const VIEW_DEDUPE_SEC = 30 * 60;

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly dto: NodeDtoService,
    private readonly store: ObjectStore,
    private readonly audit: AuditService,
    private readonly events: NodeEventsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly transcodes: TranscodeQueueService,
    private readonly hls: HlsSessions,
  ) {}

  async detail(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', AS_VIDEO);
    await this.audit.logView(user.id, node, ctx);
    const [video, info, watch] = await Promise.all([
      this.prisma.client.video.findUnique({ where: { nodeId } }),
      this.prisma.client.fileInfo.findUnique({
        where: { nodeId },
        select: { processingError: true },
      }),
      this.prisma.client.videoWatch.findUnique({
        where: { userId_nodeId: { userId: user.id, nodeId } },
      }),
    ]);
    return {
      node: await this.dto.one(user.id, nodeId),
      video: video
        ? {
            durationSec: video.durationSec,
            width: video.width,
            height: video.height,
            renditions: (
              video.renditions as Array<{
                name: string;
                width: number;
                height: number;
                bandwidth: number;
              }>
            ).map(({ name, width, height, bandwidth }) => ({ name, width, height, bandwidth })),
            viewCount: video.viewCount,
            transcodedAt: video.transcodedAt,
          }
        : null,
      processingError: info?.processingError ?? null,
      resumeAt: watch?.positionSec ?? null,
    };
  }

  async saveProgress(user: AuthenticatedUser, nodeId: string, positionSec: number) {
    await this.access.requireNode(user, nodeId, 'VIEWER', AS_VIDEO);
    await this.prisma.client.videoWatch.upsert({
      where: { userId_nodeId: { userId: user.id, nodeId } },
      create: { userId: user.id, nodeId, positionSec },
      update: { positionSec },
    });
  }

  async startPlayback(
    user: AuthenticatedUser,
    nodeId: string,
    ctx: RequestContext,
    sessionId: string,
    opts: { viaTunnel: boolean },
  ) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', AS_VIDEO);
    const video = await this.prisma.client.video.findUnique({ where: { nodeId } });
    if (!video) throw AppError.conflict('This video is not ready to play yet');
    const [hls, poster, me, watch] = await Promise.all([
      this.prisma.client.blob.findUniqueOrThrow({ where: { id: video.hlsBlobId } }),
      video.posterBlobId
        ? this.prisma.client.blob.findUnique({ where: { id: video.posterBlobId } })
        : null,
      this.prisma.client.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { name: true, email: true },
      }),
      this.prisma.client.videoWatch.findUnique({
        where: { userId_nodeId: { userId: user.id, nodeId } },
      }),
    ]);

    const { token, masterUrl, expiresAt } = await this.hls.open({
      userId: user.id,
      sessionId,
      nodeId,
      hls,
    });

    const fresh = await this.redis
      .set(`video:view:${user.id}:${nodeId}`, '1', 'EX', VIEW_DEDUPE_SEC, 'NX')
      .catch(() => 'OK');
    if (fresh) {
      await this.prisma.client.video.update({
        where: { nodeId },
        data: { viewCount: { increment: 1 } },
      });
      await this.audit.log({
        actorId: user.id,
        action: 'video.play',
        targetType: 'node',
        targetId: nodeId,
        workspaceId: node.workspaceId,
        metadata: { name: node.name },
        ctx,
      });
    }

    return {
      masterUrl,
      token,
      expiresAt,
      posterUrl: poster
        ? (
            await this.store.presignGet(poster, {
              ...PREVIEW_URL,
              contentType: poster.mime,
              disposition: { type: 'inline', fileName: 'poster.jpg' },
            })
          ).url
        : null,
      watermark: { name: me.name, email: me.email },
      resumeAt: watch?.positionSec ?? null,
      durationSec: video.durationSec,
      maxHeight: opts.viaTunnel ? this.config.REMOTE_VIDEO_MAX_HEIGHT : null,
    };
  }

  async posterUrl(user: AuthenticatedUser, nodeId: string): Promise<string> {
    await this.access.requireNode(user, nodeId, 'VIEWER', AS_VIDEO);
    const video = await this.prisma.client.video.findUnique({
      where: { nodeId },
      select: { posterBlobId: true },
    });
    const poster = video?.posterBlobId
      ? await this.prisma.client.blob.findUnique({ where: { id: video.posterBlobId } })
      : null;
    if (!poster) throw AppError.notFound('This video has no poster yet');
    return (
      await this.store.presignGet(poster, {
        ...PREVIEW_URL,
        contentType: poster.mime,
        disposition: { type: 'inline', fileName: 'poster.jpg' },
      })
    ).url;
  }

  async spriteVtt(user: AuthenticatedUser, nodeId: string): Promise<string> {
    await this.access.requireNode(user, nodeId, 'VIEWER', AS_VIDEO);
    const video = await this.prisma.client.video.findUnique({
      where: { nodeId },
      select: { spriteBlobId: true, spriteVtt: true },
    });
    const sprite = video?.spriteBlobId
      ? await this.prisma.client.blob.findUnique({ where: { id: video.spriteBlobId } })
      : null;
    if (!sprite || !video?.spriteVtt)
      throw AppError.notFound('This video has no preview thumbnails yet');
    const { url } = await this.store.presignGet(sprite, {
      ...PREVIEW_URL,
      contentType: sprite.mime,
      disposition: { type: 'inline', fileName: 'sprite.jpg' },
    });
    return video.spriteVtt.replaceAll('sprite.jpg#', `${url}#`);
  }

  async retranscode(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR', AS_VIDEO);
    const current = await this.prisma.client.node.findUniqueOrThrow({
      where: { id: nodeId },
      select: { status: true, file: { select: { currentVersionId: true } } },
    });
    if (current.status === 'UPLOADING' || current.status === 'PROCESSING') {
      throw AppError.conflict('This video is still being uploaded or processed');
    }
    const versionId = current.file?.currentVersionId;
    if (!versionId) throw AppError.notFound('This video has no uploaded content yet');
    await this.enqueueTranscode(nodeId, versionId);
    await this.audit.log({
      actorId: user.id,
      action: 'video.retranscode',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name },
      ctx,
    });
  }

  async enqueueTranscode(nodeId: string, versionId: string) {
    await this.transcodes.enqueue(nodeId, versionId);
    await this.prisma.client.node.update({ where: { id: nodeId }, data: { status: 'PROCESSING' } });
    await this.events.publish({ nodeId, status: 'PROCESSING', progress: 0 });
  }
}
