import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { requestContext } from '../../common/http/request-context.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodOk } from '../../common/swagger/zod-openapi.js';
import { MinutesService } from './minutes.service.js';
import {
  minutesSchema,
  publishBody,
  type PublishBody,
  publishResultSchema,
  retryResultSchema,
  saveDraftBody,
  type SaveDraftBody,
  saveDraftResultSchema,
} from './minutes.schemas.js';

const uuid = () => new ParseUUIDPipe();

@ApiTags('meetings')
@ApiBearerAuth()
@Controller('meetings/:id/minutes')
export class MinutesController {
  constructor(private readonly minutes: MinutesService) {}

  @Get()
  @ApiOperation({
    summary: 'Trạng thái biên bản AI; bản nháp chỉ cho người tạo buổi họp và quản trị workspace',
  })
  @ApiZodOk(minutesSchema)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.minutes.get(user, id);
  }

  @Put('draft')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Lưu bản nháp biên bản (người duyệt)',
    description: 'revision lệch hoặc biên bản không còn chờ duyệt trả 409.',
  })
  @ApiZodBody(saveDraftBody)
  @ApiZodOk(saveDraftResultSchema)
  saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(saveDraftBody)) body: SaveDraftBody,
  ) {
    return this.minutes.saveDraft(user, id, body);
  }

  @Post('publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Gửi biên bản thành tài liệu trong thư mục "Biên bản họp" (người duyệt)',
    description: 'Gửi lần hai, hoặc revision lệch, trả 409; chỉ một tài liệu được tạo.',
  })
  @ApiZodBody(publishBody, { revision: 1, confirmedUserIds: [] })
  @ApiZodOk(publishResultSchema)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(publishBody)) body: PublishBody,
    @Req() req: Request,
  ) {
    return this.minutes.publish(user, id, body, requestContext(req));
  }

  @Post('retry')
  @HttpCode(202)
  @ApiOperation({ summary: 'Chạy lại biên bản bị lỗi (người duyệt)' })
  @ApiResponse({ status: 202, description: 'Đã xếp hàng chạy lại' })
  @ApiZodOk(retryResultSchema)
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.minutes.retry(user, id, requestContext(req));
  }
}
