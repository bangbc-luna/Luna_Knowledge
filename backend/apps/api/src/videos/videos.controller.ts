import { pipeline } from 'node:stream/promises';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentSession } from '../auth/decorators/current-session.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { SystemAdmin } from '../auth/decorators/system-admin.decorator.js';
import { requestContext, viaTunnel } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import { NodesService } from '../content/nodes.service.js';
import { nodeSchema } from '../content/nodes.schemas.js';
import { contentDisposition } from '../files/storage.service.js';
import { AdminVideosService } from './admin-videos.service.js';
import {
  adminVideoSchema,
  adminVideosQuery,
  type AdminVideosQuery,
  playbackSchema,
  progressBody,
  sessionQuery,
  type SessionQuery,
  videoDetailSchema,
  videoInfoBody,
} from './videos.schemas.js';
import { VideosService } from './videos.service.js';

const uuid = () => new ParseUUIDPipe();
const session = () => new ZodValidationPipe(sessionQuery);
const M3U8 = 'application/vnd.apple.mpegurl';

@ApiTags('videos')
@ApiBearerAuth()
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videos: VideosService,
    private readonly nodes: NodesService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Chi tiết video: thời lượng, các bậc chất lượng, lượt xem, vị trí xem dở (VIEWER)',
  })
  @ApiZodOk(videoDetailSchema)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.videos.detail(user, id, requestContext(req));
  }

  @Post(':id/playback')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Bắt đầu phiên xem (VIEWER)',
    description:
      'Trả `masterUrl` cho hls.js và thông tin watermark (tên + email; FE vẽ thêm giờ hiện tại). ' +
      'Mỗi người mở lại trong 30 phút tính một lượt xem, ghi nhật ký `video.play`. Video chưa transcode xong → 409.',
  })
  @ApiZodOk(playbackSchema)
  playback(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.videos.startPlayback(user, id, requestContext(req), sessionId, {
      viaTunnel: viaTunnel(req),
    });
  }

  @Public()
  @SkipThrottle()
  @Get(':id/hls/master.m3u8')
  @Header('Content-Type', M3U8)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Master playlist (theo phiên xem `s`)' })
  @ApiZodQuery(sessionQuery)
  master(@Param('id', uuid()) id: string, @Query(session()) q: SessionQuery) {
    return this.videos.masterPlaylist(id, q.s);
  }

  @Public()
  @SkipThrottle()
  @Get(':id/hls/:rendition/index.m3u8')
  @Header('Content-Type', M3U8)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Media playlist của một bậc chất lượng (theo phiên xem)' })
  @ApiZodQuery(sessionQuery)
  media(
    @Param('id', uuid()) id: string,
    @Param('rendition') rendition: string,
    @Query(session()) q: SessionQuery,
  ) {
    return this.videos.mediaPlaylist(id, rendition, q.s);
  }

  @Public()
  @SkipThrottle()
  @Get(':id/hls/:rendition/:segment')
  @ApiOperation({ summary: 'Segment: chuyển hướng tới URL ký sẵn sống 2 phút (theo phiên xem)' })
  @ApiZodQuery(sessionQuery)
  @ApiFoundResponse({ description: 'Location: URL MinIO ký sẵn' })
  async segment(
    @Param('id', uuid()) id: string,
    @Param('rendition') rendition: string,
    @Param('segment') segment: string,
    @Query(session()) q: SessionQuery,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, await this.videos.segmentUrl(id, rendition, segment, q.s));
  }

  @Public()
  @SkipThrottle()
  @Get(':id/key')
  @ApiOperation({ summary: 'Khoá AES-128 (16 byte) cho phiên xem, có giới hạn số lần' })
  @ApiZodQuery(sessionQuery)
  @ApiProduces('application/octet-stream')
  async key(
    @Param('id', uuid()) id: string,
    @Query(session()) q: SessionQuery,
    @Res() res: Response,
  ) {
    const key = await this.videos.key(id, q.s);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(key);
  }

  @Put(':id/progress')
  @HttpCode(204)
  @ApiOperation({ summary: 'Lưu vị trí đang xem (giây) để xem tiếp lần sau' })
  @ApiZodBody(progressBody)
  @ApiNoContentResponse()
  async progress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(progressBody)) body: z.output<typeof progressBody>,
  ) {
    await this.videos.saveProgress(user, id, body.positionSec);
  }

  @Get(':id/poster')
  @ApiOperation({ summary: 'Chuyển hướng tới ảnh poster' })
  @ApiFoundResponse({ description: 'Location: URL ký sẵn' })
  async poster(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Res() res: Response,
  ) {
    res.redirect(302, await this.videos.posterUrl(user, id));
  }

  @Get(':id/sprite.vtt')
  @Header('Content-Type', 'text/vtt; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'WebVTT ảnh xem trước khi tua (ảnh sprite là URL ký 10 phút)' })
  @ApiOkResponse({ description: 'WebVTT' })
  sprite(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.videos.spriteVtt(user, id);
  }

  @Post(':id/retranscode')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Transcode lại từ file gốc (EDITOR), dùng khi lỗi hoặc mất dữ liệu HLS',
  })
  @ApiNoContentResponse()
  async retranscode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    await this.videos.retranscode(user, id, requestContext(req));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa tiêu đề và mô tả video (EDITOR); trùng tên → 409 kèm gợi ý' })
  @ApiZodBody(videoInfoBody, {
    title: 'Hướng dẫn quy trình nhập kho',
    description: 'Các bước nhập kho từ lúc nhận hàng tới khi cập nhật phần mềm.',
  })
  @ApiZodOk(nodeSchema)
  updateInfo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(videoInfoBody)) body: z.output<typeof videoInfoBody>,
    @Req() req: Request,
  ) {
    return this.nodes.updateDetails(
      user,
      id,
      { name: body.title, description: body.description },
      requestContext(req),
      'VIDEO',
    );
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@SystemAdmin()
@Controller('admin/videos')
export class AdminVideosController {
  constructor(private readonly videos: AdminVideosService) {}

  @Get()
  @ApiOperation({ summary: '[Admin] Danh sách video toàn hệ thống (để lấy file gốc)' })
  @ApiZodQuery(adminVideosQuery)
  @ApiZodOk(z.array(adminVideoSchema))
  list(@Query(new ZodValidationPipe(adminVideosQuery)) q: AdminVideosQuery) {
    return this.videos.list(q);
  }

  @Post(':id/original-link')
  @ApiOperation({
    summary: '[Admin] Link tải file gốc video, dùng một lần (60 giây)',
    description:
      'Mỗi lượt tải ghi nhật ký `video.original_access`. Người dùng thường không có đường nào tải video.',
  })
  @ApiZodCreated(z.object({ url: z.string(), expiresAt: z.date() }))
  originalLink(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.videos.createOriginalLink(user, id);
  }
}

@ApiTags('admin')
@Controller('downloads/video')
export class AdminVideoDownloadController {
  constructor(private readonly videos: AdminVideosService) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: '[Admin] Tải file gốc video bằng link dùng một lần' })
  @ApiProduces('application/octet-stream')
  async redeem(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const file = await this.videos.redeemOriginalLink(token, requestContext(req));
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', contentDisposition('attachment', file.fileName));
    res.setHeader('Cache-Control', 'private, no-store');
    await pipeline(file.body, res);
  }
}
