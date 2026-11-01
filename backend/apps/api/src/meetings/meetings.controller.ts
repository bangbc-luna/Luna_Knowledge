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
  handBody,
  type HandBody,
  handResultSchema,
  chatMessagePageSchema,
  chatMessageSchema,
  createMeetingBody,
  type CreateMeetingBody,
  inviteBody,
  type InviteBody,
  invitesAddedSchema,
  joinMeetingSchema,
  listMeetingsQuery,
  listMessagesQuery,
  type ListMessagesQuery,
  type ListMeetingsQuery,
  meetingDetailSchema,
  meetingPageSchema,
  meetingSchema,
  muteResultSchema,
  sendMessageBody,
  type SendMessageBody,
  updateMeetingBody,
  type UpdateMeetingBody,
} from './meetings.schemas.js';
import { MeetingChatService } from './meeting-chat.service.js';
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
    private readonly chat: MeetingChatService,
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
  @ApiOperation({ summary: 'Sửa buổi họp chưa bắt đầu (người tạo hoặc quản trị workspace)' })
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
  @ApiOperation({ summary: 'Huỷ buổi họp chưa bắt đầu (người tạo hoặc quản trị workspace)' })
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
    summary: 'Mời người theo email (người tạo hoặc quản trị workspace)',
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
  @ApiOperation({ summary: 'Bỏ lời mời (người tạo hoặc quản trị workspace)' })
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

  @Put('meetings/:id/hand')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Giơ hoặc hạ tay của chính mình trong buổi họp đang diễn ra',
    description:
      'Đặt thuộc tính handRaised của người gọi trong phòng; người gọi phải đang ở trong phòng.',
  })
  @ApiZodBody(handBody, { raised: true })
  @ApiZodOk(handResultSchema)
  setHand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(handBody)) body: HandBody,
  ) {
    return this.room.setHand(user, id, body.raised);
  }

  @Post('meetings/:id/messages')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Gửi tin nhắn vào buổi họp đang diễn ra',
    description:
      'Nội dung lưu nguyên văn, không biến đổi HTML; giao diện phải hiển thị như văn bản thuần.',
  })
  @ApiZodBody(sendMessageBody, { body: 'Mọi người xem link này nhé' })
  @ApiZodCreated(chatMessageSchema)
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(sendMessageBody)) body: SendMessageBody,
  ) {
    return this.chat.send(user, id, body);
  }

  @Get('meetings/:id/messages')
  @ApiOperation({ summary: 'Lịch sử chat của buổi họp, cũ đến mới (kể cả sau khi kết thúc)' })
  @ApiZodQuery(listMessagesQuery)
  @ApiZodOk(chatMessagePageSchema)
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(listMessagesQuery)) q: ListMessagesQuery,
  ) {
    return this.chat.list(user, id, q);
  }
}
