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
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import {
  createdThreadSchema,
  createThreadBody,
  type CreateThreadBody,
  editCommentBody,
  replyBody,
  type ReplyBody,
  threadSchema,
  threadsQuery,
  type ThreadsQuery,
} from './comments.schemas.js';
import { CommentsService } from './comments.service.js';

const uuid = () => new ParseUUIDPipe();

@ApiTags('comments')
@ApiBearerAuth()
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('documents/:id/threads')
  @ApiOperation({ summary: 'Thread comment của tài liệu' })
  @ApiZodQuery(threadsQuery)
  @ApiZodOk(z.array(threadSchema))
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(threadsQuery)) q: ThreadsQuery,
  ) {
    return this.comments.list(user, id, q);
  }

  @Post('documents/:id/threads')
  @ApiOperation({
    summary: 'Tạo thread comment (VIEWER trở lên)',
    description:
      'FE gắn mark `comment` với `threadId` trả về lên đoạn đã chọn. @nhắc người không xem được tài liệu thì bị bỏ (`ignoredMentions`).',
  })
  @ApiZodBody(createThreadBody)
  @ApiZodCreated(createdThreadSchema)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(createThreadBody)) body: CreateThreadBody,
    @Req() req: Request,
  ) {
    return this.comments.createThread(user, id, body, requestContext(req));
  }

  @Post('threads/:tid/comments')
  @ApiOperation({ summary: 'Trả lời thread (mở lại nếu đã resolve)' })
  @ApiZodBody(replyBody)
  @ApiZodCreated(createdThreadSchema)
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tid', uuid()) tid: string,
    @Body(new ZodValidationPipe(replyBody)) body: ReplyBody,
    @Req() req: Request,
  ) {
    return this.comments.reply(user, tid, body, requestContext(req));
  }

  @Patch('comments/:cid')
  @ApiOperation({ summary: 'Sửa comment của mình' })
  @ApiZodBody(editCommentBody)
  @ApiZodOk(threadSchema)
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cid', uuid()) cid: string,
    @Body(new ZodValidationPipe(editCommentBody)) body: z.output<typeof editCommentBody>,
  ) {
    return this.comments.edit(user, cid, body.body);
  }

  @Delete('comments/:cid')
  @ApiOperation({ summary: 'Xoá comment (tác giả hoặc ADMIN); xoá comment cuối thì xoá cả thread' })
  @ApiZodOk(z.object({ threadDeleted: z.boolean() }))
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cid', uuid()) cid: string,
    @Req() req: Request,
  ) {
    return this.comments.remove(user, cid, requestContext(req));
  }

  @Post('threads/:tid/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve thread (EDITOR hoặc người tạo thread)' })
  @ApiZodOk(threadSchema)
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tid', uuid()) tid: string,
    @Req() req: Request,
  ) {
    return this.comments.setStatus(user, tid, 'RESOLVED', requestContext(req));
  }

  @Post('threads/:tid/reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mở lại thread' })
  @ApiZodOk(threadSchema)
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tid', uuid()) tid: string,
    @Req() req: Request,
  ) {
    return this.comments.setStatus(user, tid, 'OPEN', requestContext(req));
  }
}
