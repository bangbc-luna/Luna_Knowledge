import { pipeline } from 'node:stream/promises';
import {
  Controller,
  Get,
  HttpCode,
  type MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
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
import { concat, interval, map, merge, type Observable, of, takeUntil } from 'rxjs';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentSession } from '../auth/decorators/current-session.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import { SessionRevocationsService } from '../infra/redis/session-revocations.service.js';
import { z } from 'zod';
import {
  duplicateInfoSchema,
  downloadLinkSchema,
  fileDetailSchema,
  fileVersionSchema,
  previewSchema,
  storageStatsSchema,
  versionQuery,
  type VersionQuery,
} from './files.schemas.js';
import { FilesService } from './files.service.js';
import { contentDisposition } from './storage.service.js';

const uuid = () => new ParseUUIDPipe();
const HEARTBEAT_MS = 25_000;

type Download = Awaited<ReturnType<FilesService['openDownload']>>;

async function sendDownload(res: Response, file: Download) {
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', contentDisposition('attachment', file.fileName));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  await pipeline(file.body, res);
}

@ApiTags('files')
@ApiBearerAuth()
@Controller()
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly revocations: SessionRevocationsService,
  ) {}

  @Get('files/:id')
  @ApiOperation({ summary: 'Chi tiết file: phiên bản hiện tại, trạng thái xử lý (VIEWER)' })
  @ApiZodOk(fileDetailSchema)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.files.detail(user, id, requestContext(req));
  }

  @Get('files/:id/duplicates')
  @ApiOperation({
    summary: 'Trạng thái xử lý và các file trùng nội dung (VIEWER)',
    description: 'Gọn hơn chi tiết file, không ghi lượt xem; dùng để hỏi lại sau khi upload xong.',
  })
  @ApiZodOk(duplicateInfoSchema)
  duplicates(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.files.duplicateInfo(user, id);
  }

  @Get('files/:id/versions')
  @ApiOperation({ summary: 'Lịch sử phiên bản (mới nhất trước)' })
  @ApiZodOk(z.array(fileVersionSchema))
  versions(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.files.versions(user, id);
  }

  @Get('files/:id/preview')
  @ApiOperation({
    summary: 'URL xem trước (PDF/ảnh/chữ), ký sẵn 10 phút',
    description: 'Office được chuyển sang PDF. `kind = none` khi định dạng không có bản xem trước.',
  })
  @ApiZodQuery(versionQuery)
  @ApiZodOk(previewSchema)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(versionQuery)) q: VersionQuery,
  ) {
    return this.files.preview(user, id, q.version);
  }

  @Get('files/:id/thumbnail')
  @ApiOperation({ summary: 'Chuyển hướng tới ảnh thumbnail (ảnh 320px)' })
  @ApiFoundResponse({ description: 'Location: URL ký sẵn' })
  async thumbnail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Res() res: Response,
  ) {
    res.redirect(302, await this.files.thumbnailUrl(user, id));
  }

  @Get('files/:id/download')
  @ApiOperation({
    summary: 'Tải file gốc (stream qua API, có ghi nhật ký)',
    description:
      'Video không tải được (403). Trình duyệt nên dùng `/download-link` để tải trực tiếp.',
  })
  @ApiZodQuery(versionQuery)
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ description: 'Nội dung file' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(versionQuery)) q: VersionQuery,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await sendDownload(
      res,
      await this.files.openDownload(user, id, q.version, requestContext(req)),
    );
  }

  @Post('files/:id/download-link')
  @ApiOperation({
    summary: 'Tạo link tải dùng một lần (60 giây)',
    description:
      'Mở link bằng `window.location` / thẻ `<a>`: trình duyệt tải thẳng, không cần token.',
  })
  @ApiZodQuery(versionQuery)
  @ApiZodCreated(downloadLinkSchema)
  downloadLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(versionQuery)) q: VersionQuery,
  ) {
    return this.files.createDownloadLink(user, id, q.version);
  }

  @Public()
  @Get('downloads/:token')
  @ApiOperation({ summary: 'Tải bằng link dùng một lần (không cần đăng nhập)' })
  @ApiProduces('application/octet-stream')
  async redeem(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    await sendDownload(res, await this.files.redeemDownloadLink(token, requestContext(req)));
  }

  @Post('files/:id/versions/:versionId/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Đặt một phiên bản cũ làm bản hiện tại (EDITOR)' })
  @ApiZodOk(fileDetailSchema)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('versionId', uuid()) versionId: string,
    @Req() req: Request,
  ) {
    return this.files.restoreVersion(user, id, versionId, requestContext(req));
  }

  @Post('files/:id/regenerate')
  @HttpCode(204)
  @ApiOperation({ summary: 'Tạo lại preview/thumbnail/chữ trích từ file gốc (EDITOR)' })
  @ApiNoContentResponse()
  async regenerate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    await this.files.regenerate(user, id, requestContext(req));
  }

  @Sse('nodes/:id/events')
  @ApiOperation({
    summary: 'Theo dõi trạng thái xử lý (Server-Sent Events)',
    description:
      'Gửi ngay trạng thái hiện tại, sau đó mỗi lần đổi `{nodeId, status, versionId?, error?}`. ' +
      'Có sự kiện `ping` mỗi 25 giây. Dùng fetch + Authorization (EventSource không gửi header).',
  })
  async events(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
    @Param('id', uuid()) id: string,
  ): Promise<Observable<MessageEvent>> {
    const { initial, stream } = await this.files.events$(user, id);
    return merge(
      concat(of(initial), stream).pipe(map((data) => ({ type: 'status', data }))),
      interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: {} }))),
    ).pipe(takeUntil(this.revocations.revoked$(sessionId)));
  }

  @Get('workspaces/:wsId/storage')
  @ApiOperation({ summary: 'Dung lượng đã dùng của workspace (thành viên)' })
  @ApiZodOk(storageStatsSchema)
  storage(@CurrentUser() user: AuthenticatedUser, @Param('wsId', uuid()) wsId: string) {
    return this.files.storageStats(user, wsId);
  }
}
