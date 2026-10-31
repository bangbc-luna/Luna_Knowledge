import {
  Body,
  Controller,
  Get,
  HttpCode,
  type MessageEvent,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { interval, map, merge, type Observable, takeUntil } from 'rxjs';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentSession } from '../auth/decorators/current-session.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { pageSchema } from '../common/pagination/cursor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import { SessionRevocationsService } from '../infra/redis/session-revocations.service.js';
import {
  markReadBody,
  type MarkReadBody,
  notificationSchema,
  notificationsQuery,
  type NotificationsQuery,
} from './notifications.schemas.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly revocations: SessionRevocationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Thông báo của tôi (mới nhất trước), kèm số chưa đọc' })
  @ApiZodQuery(notificationsQuery)
  @ApiZodOk(pageSchema(notificationSchema).extend({ unreadCount: z.number().int() }))
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(notificationsQuery)) q: NotificationsQuery,
  ) {
    return this.notifications.list(user.id, q);
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Đánh dấu đã đọc `{ids}` hoặc `{all: true}`' })
  @ApiZodBody(markReadBody)
  @ApiZodOk(z.object({ updated: z.number().int() }))
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(markReadBody)) body: MarkReadBody,
  ) {
    return this.notifications.markRead(user.id, body);
  }

  @Sse('stream')
  @ApiOperation({ summary: 'Thông báo mới theo thời gian thực (SSE), ping mỗi 25 giây' })
  stream(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() sessionId: string,
  ): Observable<MessageEvent> {
    return merge(
      this.notifications.stream(user.id).pipe(map((data) => ({ type: 'notification', data }))),
      interval(25_000).pipe(map(() => ({ type: 'ping', data: {} }))),
    ).pipe(takeUntil(this.revocations.revoked$(sessionId)));
  }
}
