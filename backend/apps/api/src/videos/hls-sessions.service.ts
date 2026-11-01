import { randomBytes } from 'node:crypto';
import { ObjectStore, openVideoKey, type ObjectRef } from '@luna/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppError } from '../common/errors/app-error.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ContentAccessService, AS_VIDEO } from '../content/content-access.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';
import { playbackIndexKey, playbackKey } from './playback-keys.js';

const SESSION_IDLE_SEC = 15 * 60;
const SESSION_MAX_SEC = 8 * 3600;
const SEGMENT_URL_TTL_SEC = 120;
const MAX_KEY_FETCHES = 30;

const RENDITION_RE = /^\d{1,4}p$/;
const SEGMENT_RE = /^seg_\d{4,6}\.ts$/;

interface Session {
  userId: string;
  sessionId: string;
  nodeId: string;
  prefix: string;
  bucket: string;
  createdAt: number;
}

@Injectable()
export class HlsSessions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly store: ObjectStore,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async open(input: {
    userId: string;
    sessionId: string;
    nodeId: string;
    hls: ObjectRef;
  }): Promise<{ token: string; masterUrl: string; expiresAt: Date }> {
    const token = randomBytes(24).toString('base64url');
    const session: Session = {
      userId: input.userId,
      sessionId: input.sessionId,
      nodeId: input.nodeId,
      prefix: input.hls.key,
      bucket: input.hls.container,
      createdAt: Date.now(),
    };
    await this.redis
      .multi()
      .set(playbackKey(token), JSON.stringify(session), 'EX', SESSION_IDLE_SEC)
      .sadd(playbackIndexKey(input.sessionId), token)
      .expire(playbackIndexKey(input.sessionId), SESSION_MAX_SEC)
      .exec();
    return {
      token,
      masterUrl: `/api/v1/videos/${input.nodeId}/hls/master.m3u8?s=${token}`,
      expiresAt: new Date(Date.now() + SESSION_IDLE_SEC * 1000),
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
    const { url } = await this.store.presignGet(
      { container: s.bucket, key: `${s.prefix}${rendition}/${segment}` },
      {
        expiresInSec: SEGMENT_URL_TTL_SEC,
        contentType: 'video/mp2t',
        disposition: 'inline',
        cacheControl: 'private, max-age=60',
      },
    );
    return url;
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

  private async requireSession(
    nodeId: string,
    token: string,
    { checkAccess = false } = {},
  ): Promise<Session> {
    const raw = await this.redis.get(playbackKey(token));
    const s = raw ? (JSON.parse(raw) as Session) : null;
    if (!s || s.nodeId !== nodeId || Date.now() - s.createdAt > SESSION_MAX_SEC * 1000) {
      throw AppError.notFound('Playback session is invalid or has expired');
    }
    if (checkAccess) {
      await this.access.requireNode({ id: s.userId }, nodeId, 'VIEWER', {
        ...AS_VIDEO,
        inactiveUser: 'Playback session is invalid or has expired',
      });
    }
    await this.redis.expire(playbackKey(token), SESSION_IDLE_SEC);
    return s;
  }

  private async readPlaylist(s: Session, path: string): Promise<string> {
    const cacheKey = `hlspl:${s.prefix}${path}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;
    const { body } = await this.store
      .getStream({ container: s.bucket, key: `${s.prefix}${path}` })
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
