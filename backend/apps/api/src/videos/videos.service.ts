import { randomBytes } from 'node:crypto';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { openVideoKey } from '@luna/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentAccessService } from '../content/content-access.service.js';
import { NodeDtoService } from '../content/node-dto.service.js';
import { NodeEventsService } from '../files/node-events.service.js';
import { StorageService } from '../files/storage.service.js';
import { TranscodeQueueService } from '../files/transcode-queue.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import { S3_PRESIGN } from '../infra/s3/s3.module.js';

const SESSION_IDLE_SEC = 15 * 60;
const SESSION_MAX_SEC = 8 * 3600;
const SEGMENT_URL_TTL_SEC = 120;
const MAX_KEY_FETCHES = 30;
const VIEW_DEDUPE_SEC = 30 * 60;

const RENDITION_RE = /^\d{1,4}p$/;
const SEGMENT_RE = /^seg_\d{4,6}\.ts$/;

interface Session {
  userId: string;
  nodeId: string;
  prefix: string;
  bucket: string;
  createdAt: number;
}

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly dto: NodeDtoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: NodeEventsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3_PRESIGN) private readonly presigner: S3Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly transcodes: TranscodeQueueService,
  ) {}

  async detail(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireVideo(user, nodeId, 'VIEWER');
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
    await this.requireVideo(user, nodeId, 'VIEWER');
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
    opts: { viaTunnel: boolean },
  ) {
    const node = await this.requireVideo(user, nodeId, 'VIEWER');
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

    const token = randomBytes(24).toString('base64url');
    const session: Session = {
      userId: user.id,
      nodeId,
      prefix: hls.key,
      bucket: hls.container,
      createdAt: Date.now(),
    };
    await this.redis.set(`pb:${token}`, JSON.stringify(session), 'EX', SESSION_IDLE_SEC);

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
      masterUrl: `/api/v1/videos/${nodeId}/hls/master.m3u8?s=${token}`,
      token,
      expiresAt: new Date(Date.now() + SESSION_IDLE_SEC * 1000),
      posterUrl: poster
        ? (
            await this.storage.presignGet(poster, {
              fileName: 'poster.jpg',
              contentType: poster.mime,
            })
          ).url
        : null,
      watermark: { name: me.name, email: me.email },
      resumeAt: watch?.positionSec ?? null,
      durationSec: video.durationSec,
      maxHeight: opts.viaTunnel ? this.config.REMOTE_VIDEO_MAX_HEIGHT : null,
    };
  }

  async masterPlaylist(nodeId: string, token: string): Promise<string> {
    const s = await this.requireSession(nodeId, token, { checkAccess: true });
    const body = await this.readPlaylist(s, 'master.m3u8');
    return body
      .split('\n')
      .map((line) => {
        const m = /^(\d{1,4}p)\/index\.m3u8$/.exec(line.trim());
        return m ? `/api/v1/videos/${nodeId}/hls/${m[1]}/index.m3u8?s=${token}` : line;
      })
      .join('\n');
  }

  async mediaPlaylist(nodeId: string, rendition: string, token: string): Promise<string> {
    if (!RENDITION_RE.test(rendition)) throw AppError.notFound('Playlist not found');
    const s = await this.requireSession(nodeId, token, { checkAccess: true });
    const body = await this.readPlaylist(s, `${rendition}/index.m3u8`);
    return body
      .split('\n')
      .map((line) => {
        if (line.startsWith('#EXT-X-KEY:')) {
          return line.replace(/URI="[^"]*"/, `URI="/api/v1/videos/${nodeId}/key?s=${token}"`);
        }
        const seg = line.trim();
        return SEGMENT_RE.test(seg)
          ? `/api/v1/videos/${nodeId}/hls/${rendition}/${seg}?s=${token}`
          : line;
      })
      .join('\n');
  }

  async segmentUrl(
    nodeId: string,
    rendition: string,
    segment: string,
    token: string,
  ): Promise<string> {
    if (!RENDITION_RE.test(rendition) || !SEGMENT_RE.test(segment))
      throw AppError.notFound('Segment not found');
    const s = await this.requireSession(nodeId, token);
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: s.bucket,
        Key: `${s.prefix}${rendition}/${segment}`,
        ResponseContentType: 'video/mp2t',
        ResponseContentDisposition: 'inline',
        ResponseCacheControl: 'private, max-age=60',
      }),
      { expiresIn: SEGMENT_URL_TTL_SEC },
    );
  }

  async key(nodeId: string, token: string): Promise<Buffer> {
    const session = await this.requireSession(nodeId, token, { checkAccess: true });
    const count = await this.redis.incr(`pb:${token}:keys`);
    if (count === 1) await this.redis.expire(`pb:${token}:keys`, SESSION_MAX_SEC);
    if (count > MAX_KEY_FETCHES) {
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        'Too many key requests for this playback session',
        429,
      );
    }
    const video = await this.prisma.client.video.findUnique({
      where: { nodeId },
      select: { keyEncrypted: true, hlsBlobId: true },
    });
    if (!video) throw AppError.notFound('Video not found');
    const hls = await this.prisma.client.blob.findUnique({
      where: { id: video.hlsBlobId },
      select: { key: true },
    });
    if (hls?.key !== session.prefix) {
      throw AppError.notFound('Playback session is out of date, start playback again');
    }
    return openVideoKey(video.keyEncrypted, this.config.VIDEO_MASTER_KEY);
  }

  async posterUrl(user: AuthenticatedUser, nodeId: string): Promise<string> {
    await this.requireVideo(user, nodeId, 'VIEWER');
    const video = await this.prisma.client.video.findUnique({
      where: { nodeId },
      select: { posterBlobId: true },
    });
    const poster = video?.posterBlobId
      ? await this.prisma.client.blob.findUnique({ where: { id: video.posterBlobId } })
      : null;
    if (!poster) throw AppError.notFound('This video has no poster yet');
    return (
      await this.storage.presignGet(poster, { fileName: 'poster.jpg', contentType: poster.mime })
    ).url;
  }

  async spriteVtt(user: AuthenticatedUser, nodeId: string): Promise<string> {
    await this.requireVideo(user, nodeId, 'VIEWER');
    const video = await this.prisma.client.video.findUnique({
      where: { nodeId },
      select: { spriteBlobId: true, spriteVtt: true },
    });
    const sprite = video?.spriteBlobId
      ? await this.prisma.client.blob.findUnique({ where: { id: video.spriteBlobId } })
      : null;
    if (!sprite || !video?.spriteVtt)
      throw AppError.notFound('This video has no preview thumbnails yet');
    const { url } = await this.storage.presignGet(sprite, {
      fileName: 'sprite.jpg',
      contentType: sprite.mime,
    });
    return video.spriteVtt.replaceAll('sprite.jpg#', `${url}#`);
  }

  async retranscode(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireVideo(user, nodeId, 'EDITOR');
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

  private async requireVideo(user: AuthenticatedUser, nodeId: string, min: 'VIEWER' | 'EDITOR') {
    const node = await this.access.requireNode(user, nodeId, min);
    if (node.type !== 'VIDEO') throw AppError.notFound('Video not found');
    return node;
  }

  private async requireSession(
    nodeId: string,
    token: string,
    { checkAccess = false } = {},
  ): Promise<Session> {
    const raw = await this.redis.get(`pb:${token}`);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    if (!s || s.nodeId !== nodeId || Date.now() - s.createdAt > SESSION_MAX_SEC * 1000) {
      throw AppError.notFound('Playback session is invalid or has expired');
    }
    if (checkAccess) {
      const user = await this.prisma.client.user.findUnique({
        where: { id: s.userId },
        select: { id: true, status: true },
      });
      if (user?.status !== 'ACTIVE')
        throw AppError.notFound('Playback session is invalid or has expired');
      await this.requireVideo({ id: user.id } as unknown as AuthenticatedUser, nodeId, 'VIEWER');
    }
    await this.redis.expire(`pb:${token}`, SESSION_IDLE_SEC);
    return s;
  }

  private async readPlaylist(s: Session, path: string): Promise<string> {
    const cacheKey = `hlspl:${s.prefix}${path}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;
    const { body } = await this.storage
      .forRef({ provider: 'S3' })
      .getStream({ provider: 'S3', container: s.bucket, key: `${s.prefix}${path}` })
      .catch(() => {
        throw AppError.notFound('Playlist not found');
      });
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.from(c as Buffer));
    const text = Buffer.concat(chunks).toString('utf8');
    await this.redis.set(cacheKey, text, 'EX', 600);
    return text;
  }
}
