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
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import {
  type AiNotesBody,
  aiNotesBody,
  aiNotesResultSchema,
  createMeetingBody,
  type CreateMeetingBody,
  inviteBody,
  type InviteBody,
  invitesAddedSchema,
  joinMeetingSchema,
  listMeetingsQuery,
  type ListMeetingsQuery,
  meetingDetailSchema,
  meetingPageSchema,
  meetingSchema,
  muteResultSchema,
  updateMeetingBody,
  type UpdateMeetingBody,
} from './meetings.schemas.js';
import { MeetingRoomService } from './meeting-room.service.js';
import { MeetingsService } from './meetings.service.js';

const uuid = () => new ParseUUIDPipe();

@ApiTags('meetings')
@ApiBearerAuth()
@Controller()
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly room: MeetingRoomService,
  ) {}

  @Post('workspaces/:wsId/meetings')
  @ApiOperation({
    summary: 'Tạo buổi họp ngay hoặc đặt lịch (MEMBER trở lên)',
    description: 'Họp ngay có status SCHEDULED, chuyển LIVE khi người đầu tiên vào phòng.',
  })
  @ApiZodBody(createMeetingBody, {
    title: 'Họp tuần',
    mode: 'scheduled',
    scheduledAt: '2026-11-03T02:00:00.000Z',
    inviteeEmails: ['dung.pham@lunatech.vn'],
  })
  @ApiZodCreated(meetingSchema)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Body(new ZodValidationPipe(createMeetingBody)) body: CreateMeetingBody,
    @Req() req: Request,
  ) {
    return this.meetings.create(user, wsId, body, requestContext(req));
  }

  @Get('workspaces/:wsId/meetings')
  @ApiOperation({ summary: 'Danh sách buổi họp của workspace theo scope (thành viên)' })
  @ApiZodQuery(listMeetingsQuery)
  @ApiZodOk(meetingPageSchema)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Query(new ZodValidationPipe(listMeetingsQuery)) q: ListMeetingsQuery,
  ) {
    return this.meetings.list(user, wsId, q);
  }

  @Get('meetings/:id')
  @ApiOperation({ summary: 'Chi tiết buổi họp (thành viên workspace hoặc người được mời)' })
  @ApiZodOk(meetingDetailSchema)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.meetings.get(user, id);
  }

  @Patch('meetings/:id')
  @ApiOperation({ summary: 'Sửa buổi họp chưa bắt đầu (chỉ người tạo)' })
  @ApiZodBody(updateMeetingBody)
  @ApiZodOk(meetingDetailSchema)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updateMeetingBody)) body: UpdateMeetingBody,
    @Req() req: Request,
  ) {
    return this.meetings.update(user, id, body, requestContext(req));
  }

  @Post('meetings/:id/cancel')
  @HttpCode(204)
  @ApiOperation({ summary: 'Huỷ buổi họp chưa bắt đầu (chỉ người tạo)' })
  @ApiNoContentResponse()
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.meetings.cancel(user, id, requestContext(req));
  }

  @Post('meetings/:id/invites')
  @ApiOperation({
    summary: 'Mời người theo email (chỉ người tạo)',
    description: 'Người ngoài workspace được tạo tài khoản trước như khi share.',
  })
  @ApiZodBody(inviteBody, { emails: ['dung.pham@lunatech.vn'] })
  @ApiZodCreated(invitesAddedSchema)
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(inviteBody)) body: InviteBody,
    @Req() req: Request,
  ) {
    return this.meetings.invite(user, id, body, requestContext(req));
  }

  @Delete('meetings/:id/invites/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Bỏ lời mời (chỉ người tạo)' })
  @ApiNoContentResponse()
  uninvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
    @Req() req: Request,
  ) {
    return this.meetings.uninvite(user, id, userId, requestContext(req));
  }

  @Post('meetings/:id/join')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Vào phòng họp, nhận token LiveKit ngắn hạn',
    description: 'Người đầu tiên vào chuyển buổi họp từ SCHEDULED sang LIVE.',
  })
  @ApiZodOk(joinMeetingSchema)
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.room.join(user, id, requestContext(req));
  }

  @Post('meetings/:id/end')
  @HttpCode(204)
  @ApiOperation({ summary: 'Kết thúc buổi họp đang diễn ra (chủ trì)' })
  @ApiNoContentResponse()
  end(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.room.end(user, id);
  }

  @Post('meetings/:id/participants/:userId/mute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tắt mic một người tham dự (chủ trì)' })
  @ApiZodOk(muteResultSchema)
  mute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
    @Req() req: Request,
  ) {
    return this.room.mute(user, id, userId, requestContext(req));
  }

  @Put('meetings/:id/ai-notes')
  @ApiOperation({ summary: 'Bật hoặc tắt ghi biên bản AI (chủ trì)' })
  @ApiZodBody(aiNotesBody, { enabled: false })
  @ApiZodOk(aiNotesResultSchema)
  setAiNotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(aiNotesBody)) body: AiNotesBody,
    @Req() req: Request,
  ) {
    return this.room.setAiNotes(user, id, body.enabled, requestContext(req));
  }
}
