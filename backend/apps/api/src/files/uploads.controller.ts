import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import {
  completeUploadBody,
  createdUploadSchema,
  createUploadBody,
  type CreateUploadBody,
  partsQuery,
  type PartsQuery,
  partUrlSchema,
  uploadSchema,
  uploadStatusSchema,
} from './uploads.schemas.js';
import { UploadsService } from './uploads.service.js';

const uuid = () => new ParseUUIDPipe();

@ApiTags('uploads')
@ApiBearerAuth()
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('workspaces/:wsId/uploads')
  @ApiOperation({
    summary: 'Bắt đầu upload (EDITOR)',
    description:
      'Tạo mục mới ở trạng thái UPLOADING (hoặc phiên bản mới với `replaceNodeId`) và trả URL ký sẵn ' +
      'cho từng part. Client `PUT` thẳng từng đoạn `partSize` byte lên URL, rồi gọi `/complete`. ' +
      'Đuôi file không được phép → 415; quá giới hạn → 413; trùng tên → 409 kèm `details.suggestion`.',
  })
  @ApiZodBody(createUploadBody, {
    parentId: '3f6c1a52-8e0b-4d7a-9c21-5b7e4f0a9d13',
    fileName: 'Hop-dong-mau.pdf',
    size: 2483712,
    mime: 'application/pdf',
    kind: 'FILE',
  })
  @ApiZodCreated(createdUploadSchema)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Body(new ZodValidationPipe(createUploadBody)) body: CreateUploadBody,
    @Req() req: Request,
  ) {
    return this.uploads.create(user, wsId, body, requestContext(req));
  }

  @Get('uploads/:id')
  @ApiOperation({
    summary: 'Trạng thái upload và các part đã nhận (để tải tiếp)',
    description: 'Chỉ người tạo upload xem được.',
  })
  @ApiZodOk(uploadStatusSchema)
  status(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.uploads.status(user, id);
  }

  @Get('uploads/:id/parts')
  @ApiOperation({ summary: 'Lấy thêm URL ký cho các part (tối đa 100 mỗi lần)' })
  @ApiZodQuery(partsQuery)
  @ApiZodOk(z.object({ parts: z.array(partUrlSchema) }))
  parts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(partsQuery)) query: PartsQuery,
  ) {
    return this.uploads.parts(user, id, query);
  }

  @Post('uploads/:id/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Hoàn tất upload',
    description:
      'Server tự kiểm tra đủ part và đúng kích thước, ghép file rồi giao cho worker xử lý ' +
      '(mục chuyển sang PROCESSING). Thiếu part → 400 kèm `details.missingParts`. Gọi lại an toàn.',
  })
  @ApiZodBody(completeUploadBody, {
    parts: [{ partNumber: 1, etag: '"9b2cf535f27731c974343645a3985328"' }],
  })
  @ApiZodOk(uploadSchema)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(completeUploadBody)) _body: unknown,
    @Req() req: Request,
  ) {
    return this.uploads.complete(user, id, requestContext(req));
  }

  @Delete('uploads/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Hủy upload (file mới thì xóa luôn mục đang chờ)' })
  @ApiNoContentResponse()
  async abort(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    await this.uploads.abort(user, id, requestContext(req));
  }
}
