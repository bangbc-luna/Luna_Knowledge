import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { pageSchema } from '../common/pagination/cursor.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import {
  createTagBody,
  type CreateTagBody,
  recentlyUpdatedQuery,
  type RecentlyUpdatedQuery,
  recentSchema,
  setNodeTagsBody,
  tagDetailSchema,
  updateTagBody,
  type UpdateTagBody,
} from './library.schemas.js';
import { LibraryService } from './library.service.js';
import { nodeSchema } from './nodes.schemas.js';

const uuid = () => new ParseUUIDPipe();

@ApiBearerAuth()
@Controller()
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('workspaces/:wsId/tags')
  @ApiTags('tags')
  @ApiOperation({ summary: 'Tag của workspace (VIEWER)' })
  @ApiZodOk(z.array(tagDetailSchema))
  listTags(@CurrentUser() user: AuthenticatedUser, @Param('wsId', uuid()) wsId: string) {
    return this.library.listTags(user, wsId);
  }

  @Post('workspaces/:wsId/tags')
  @ApiTags('tags')
  @ApiOperation({ summary: 'Tạo tag (EDITOR)' })
  @ApiZodBody(createTagBody, { name: 'Quy định', color: '#1f6feb' })
  @ApiZodCreated(tagDetailSchema)
  createTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Body(new ZodValidationPipe(createTagBody)) body: CreateTagBody,
    @Req() req: Request,
  ) {
    return this.library.createTag(user, wsId, body, requestContext(req));
  }

  @Patch('tags/:tagId')
  @ApiTags('tags')
  @ApiOperation({ summary: 'Sửa tag (ADMIN)' })
  @ApiZodBody(updateTagBody)
  @ApiZodOk(tagDetailSchema)
  updateTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tagId', uuid()) tagId: string,
    @Body(new ZodValidationPipe(updateTagBody)) body: UpdateTagBody,
    @Req() req: Request,
  ) {
    return this.library.updateTag(user, tagId, body, requestContext(req));
  }

  @Delete('tags/:tagId')
  @HttpCode(204)
  @ApiTags('tags')
  @ApiOperation({ summary: 'Xóa tag (ADMIN); gỡ khỏi mọi mục' })
  @ApiNoContentResponse()
  deleteTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tagId', uuid()) tagId: string,
    @Req() req: Request,
  ) {
    return this.library.deleteTag(user, tagId, requestContext(req));
  }

  @Put('nodes/:id/tags')
  @ApiTags('tags')
  @ApiOperation({ summary: 'Gán tag cho mục, thay toàn bộ danh sách (EDITOR)' })
  @ApiZodBody(setNodeTagsBody)
  @ApiZodOk(nodeSchema)
  setNodeTags(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(setNodeTagsBody)) body: z.output<typeof setNodeTagsBody>,
  ) {
    return this.library.setNodeTags(user, id, body.tagIds);
  }

  @Put('nodes/:id/favorite')
  @HttpCode(204)
  @ApiTags('favorites')
  @ApiOperation({ summary: 'Đánh dấu yêu thích' })
  @ApiNoContentResponse()
  addFavorite(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.library.addFavorite(user, id);
  }

  @Delete('nodes/:id/favorite')
  @HttpCode(204)
  @ApiTags('favorites')
  @ApiOperation({ summary: 'Bỏ yêu thích' })
  @ApiNoContentResponse()
  removeFavorite(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.library.removeFavorite(user, id);
  }

  @Get('me/favorites')
  @ApiTags('favorites')
  @ApiOperation({ summary: 'Mục yêu thích của tôi (chỉ mục còn quyền xem)' })
  @ApiZodOk(z.array(nodeSchema))
  favorites(@CurrentUser() user: AuthenticatedUser) {
    return this.library.favorites(user);
  }

  @Get('me/recent')
  @ApiTags('favorites')
  @ApiOperation({ summary: '50 tài liệu/file/video mở gần đây' })
  @ApiZodOk(z.array(recentSchema))
  recent(@CurrentUser() user: AuthenticatedUser) {
    return this.library.recent(user);
  }

  @Get('workspaces/:wsId/recently-updated')
  @ApiTags('favorites')
  @ApiOperation({ summary: 'Tài liệu/tệp/video mới sửa trong workspace (lọc theo quyền xem)' })
  @ApiZodQuery(recentlyUpdatedQuery)
  @ApiZodOk(pageSchema(nodeSchema))
  recentlyUpdated(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Query(new ZodValidationPipe(recentlyUpdatedQuery)) query: RecentlyUpdatedQuery,
  ) {
    return this.library.recentlyUpdated(user, wsId, query);
  }
}
