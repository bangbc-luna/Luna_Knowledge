import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import { contentDisposition } from '../files/storage.service.js';
import {
  assetSchema,
  collabTokenSchema,
  createDocumentBody,
  type CreateDocumentBody,
  createVersionBody,
  diffQuery,
  type DiffQuery,
  diffSchema,
  documentSchema,
  exportQuery,
  versionDetailSchema,
  versionSummarySchema,
} from './documents.schemas.js';
import { DocumentsService, type UploadedAsset } from './documents.service.js';
import { VersionsService } from './versions.service.js';

const uuid = () => new ParseUUIDPipe();
const MAX_UPLOAD = 20 * 1024 * 1024;

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly versions: VersionsService,
  ) {}

  @Post('workspaces/:wsId/documents')
  @ApiOperation({
    summary: 'Tạo tài liệu trống (EDITOR)',
    description: 'Trùng tên → 409 kèm `details.suggestion`.',
  })
  @ApiZodBody(createDocumentBody)
  @ApiZodCreated(documentSchema)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Body(new ZodValidationPipe(createDocumentBody)) body: CreateDocumentBody,
    @Req() req: Request,
  ) {
    return this.documents.create(user, wsId, body, requestContext(req));
  }

  @Get('documents/:id')
  @ApiOperation({
    summary: 'Tài liệu: thông tin + nội dung JSON để hiện ngay trước khi kết nối collab (VIEWER)',
  })
  @ApiZodOk(documentSchema)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.documents.get(user, id, requestContext(req));
  }

  @Get('documents/:id/collab-token')
  @ApiOperation({
    summary: 'Token kết nối collab server (5 phút)',
    description:
      'Dùng cho `HocuspocusProvider({ url, name: documentName, token })`; xin token mới mỗi lần kết nối lại. VIEWER kết nối chỉ đọc.',
  })
  @ApiZodOk(collabTokenSchema)
  collabToken(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.documents.collabToken(user, id);
  }

  @Get('documents/:id/export')
  @ApiOperation({ summary: 'Xuất tài liệu ra HTML hoặc Markdown (ghi nhật ký)' })
  @ApiZodQuery(exportQuery)
  @ApiProduces('text/html', 'text/markdown')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(exportQuery)) q: z.output<typeof exportQuery>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const out = await this.documents.export(user, id, q.format, requestContext(req));
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Disposition', contentDisposition('attachment', out.fileName));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(out.body);
  }

  @Post('documents/:id/assets')
  @ApiOperation({
    summary: 'Upload ảnh/file nhúng vào tài liệu (EDITOR, ≤ 20 MB)',
    description: 'Ảnh PNG/JPEG/WebP/GIF, PDF, Office. Kiểm loại thật theo nội dung.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiZodCreated(assetSchema)
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD + 1 } }),
  )
  uploadAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @UploadedFile() file?: UploadedAsset,
  ) {
    return this.documents.uploadAsset(user, id, file);
  }

  @Get('documents/:id/assets')
  @ApiOperation({
    summary: 'Danh sách ảnh/file nhúng kèm URL ký 10 phút (FE thay src ảnh theo assetId)',
  })
  @ApiZodOk(z.array(assetSchema))
  listAssets(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.documents.listAssets(user, id);
  }

  @Post('files/:id/convert-to-document')
  @ApiOperation({
    summary: 'Import tệp .docx thành tài liệu soạn thảo được, cùng thư mục (EDITOR)',
  })
  @ApiZodCreated(documentSchema)
  importDocx(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.documents.importDocx(user, id, requestContext(req));
  }

  @Get('documents/:id/versions')
  @ApiOperation({ summary: 'Lịch sử phiên bản (mới nhất trước)' })
  @ApiZodOk(z.array(versionSummarySchema))
  listVersions(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.versions.list(user, id);
  }

  @Post('documents/:id/versions')
  @ApiOperation({ summary: 'Lưu phiên bản có tên từ nội dung đang sửa (EDITOR)' })
  @ApiZodBody(createVersionBody)
  @ApiZodCreated(versionSummarySchema)
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(createVersionBody)) body: z.output<typeof createVersionBody>,
    @Req() req: Request,
  ) {
    return this.versions.createNamed(user, id, body.name, requestContext(req));
  }

  @Get('documents/:id/versions/:vid')
  @ApiOperation({ summary: 'Nội dung một phiên bản (JSON + HTML)' })
  @ApiZodOk(versionDetailSchema)
  getVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('vid', uuid()) vid: string,
  ) {
    return this.versions.get(user, id, vid);
  }

  @Get('documents/:id/versions/:vid/diff')
  @ApiOperation({
    summary: 'So sánh phiên bản với phiên bản khác hoặc nội dung hiện tại (theo từ)',
  })
  @ApiZodQuery(diffQuery)
  @ApiZodOk(diffSchema)
  diff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('vid', uuid()) vid: string,
    @Query(new ZodValidationPipe(diffQuery)) q: DiffQuery,
  ) {
    return this.versions.diff(user, id, vid, q.with);
  }

  @Post('documents/:id/versions/:vid/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Khôi phục một phiên bản (EDITOR)',
    description:
      'Áp lên tài liệu đang mở qua collab server (người đang sửa thấy ngay), tạo phiên bản mới, không ghi đè lịch sử.',
  })
  @ApiZodOk(versionSummarySchema)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('vid', uuid()) vid: string,
    @Req() req: Request,
  ) {
    return this.versions.restore(user, id, vid, requestContext(req));
  }
}
