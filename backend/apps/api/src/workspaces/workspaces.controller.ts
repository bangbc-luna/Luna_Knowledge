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
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import {
  addMemberBody,
  type AddMemberBody,
  createWorkspaceBody,
  type CreateWorkspaceBody,
  listWorkspacesQuery,
  memberSchema,
  updateMemberBody,
  type UpdateMemberBody,
  updateWorkspaceBody,
  type UpdateWorkspaceBody,
  workspaceSchema,
} from './workspaces.schemas.js';
import { WorkspacesService } from './workspaces.service.js';

const wsId = () => new ParseUUIDPipe();

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'Workspace của tôi (System Admin: `scope=all` để xem tất cả)' })
  @ApiZodQuery(listWorkspacesQuery)
  @ApiZodOk(z.array(workspaceSchema))
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listWorkspacesQuery)) query: z.output<typeof listWorkspacesQuery>,
  ) {
    return this.workspaces.list(user, query.scope);
  }

  @Post()
  @ApiOperation({
    summary: 'Tạo workspace nhóm/dự án; người tạo là quản trị, memberEmails là thành viên ban đầu',
  })
  @ApiZodBody(createWorkspaceBody)
  @ApiZodCreated(workspaceSchema)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createWorkspaceBody)) body: CreateWorkspaceBody,
    @Req() req: Request,
  ) {
    return this.workspaces.create(user, body, requestContext(req));
  }

  @Get(':wsId')
  @ApiOperation({ summary: 'Chi tiết workspace (thành viên)' })
  @ApiZodOk(workspaceSchema)
  get(@CurrentUser() user: AuthenticatedUser, @Param('wsId', wsId()) id: string) {
    return this.workspaces.get(user, id);
  }

  @Patch(':wsId')
  @ApiOperation({ summary: 'Sửa tên, mô tả, icon (quản trị workspace)' })
  @ApiZodBody(updateWorkspaceBody)
  @ApiZodOk(workspaceSchema)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', wsId()) id: string,
    @Body(new ZodValidationPipe(updateWorkspaceBody)) body: UpdateWorkspaceBody,
    @Req() req: Request,
  ) {
    return this.workspaces.update(user, id, body, requestContext(req));
  }

  @Delete(':wsId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Xóa mềm workspace (quản trị workspace; không xoá được workspace công ty)',
  })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', wsId()) id: string,
    @Req() req: Request,
  ) {
    return this.workspaces.remove(user, id, requestContext(req));
  }

  @Get(':wsId/members')
  @ApiTags('members')
  @ApiOperation({ summary: 'Danh sách thành viên (thành viên)' })
  @ApiZodOk(z.array(memberSchema))
  members(@CurrentUser() user: AuthenticatedUser, @Param('wsId', wsId()) id: string) {
    return this.workspaces.listMembers(user, id);
  }

  @Post(':wsId/members')
  @ApiTags('members')
  @ApiOperation({
    summary:
      'Thêm thành viên theo email (quản trị workspace). Workspace công ty: đặt vai trò cho người đã có',
  })
  @ApiZodBody(addMemberBody)
  @ApiZodCreated(memberSchema)
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', wsId()) id: string,
    @Body(new ZodValidationPipe(addMemberBody)) body: AddMemberBody,
    @Req() req: Request,
  ) {
    return this.workspaces.addMember(user, id, body, requestContext(req));
  }

  @Patch(':wsId/members/:userId')
  @ApiTags('members')
  @ApiOperation({
    summary: 'Đổi vai trò thành viên (quản trị workspace); luôn phải còn một quản trị',
  })
  @ApiZodBody(updateMemberBody)
  @ApiZodOk(memberSchema)
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', wsId()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(updateMemberBody)) body: UpdateMemberBody,
    @Req() req: Request,
  ) {
    return this.workspaces.updateMember(user, id, userId, body, requestContext(req));
  }

  @Delete(':wsId/members/:userId')
  @HttpCode(204)
  @ApiTags('members')
  @ApiOperation({
    summary: 'Gỡ thành viên (quản trị), hoặc tự rời workspace; luôn phải còn một quản trị',
  })
  @ApiNoContentResponse()
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', wsId()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ) {
    return this.workspaces.removeMember(user, id, userId, requestContext(req));
  }
}
