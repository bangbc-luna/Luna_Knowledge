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
import { SystemAdmin } from '../auth/decorators/system-admin.decorator.js';
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
  transferOwnershipBody,
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
  @SystemAdmin()
  @ApiOperation({ summary: '[Admin] Tạo workspace và chỉ định OWNER' })
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
  @ApiOperation({ summary: 'Chi tiết workspace (VIEWER)' })
  @ApiZodOk(workspaceSchema)
  get(@CurrentUser() user: AuthenticatedUser, @Param('wsId', wsId()) id: string) {
    return this.workspaces.get(user, id);
  }

  @Patch(':wsId')
  @ApiOperation({ summary: 'Sửa tên, mô tả, icon (OWNER)' })
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
  @ApiOperation({ summary: 'Xóa mềm workspace (OWNER)' })
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
  @ApiOperation({ summary: 'Danh sách thành viên (VIEWER)' })
  @ApiZodOk(z.array(memberSchema))
  members(@CurrentUser() user: AuthenticatedUser, @Param('wsId', wsId()) id: string) {
    return this.workspaces.listMembers(user, id);
  }

  @Post(':wsId/members')
  @ApiTags('members')
  @ApiOperation({ summary: 'Thêm thành viên theo email (ADMIN). Role: ADMIN | EDITOR | VIEWER' })
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
  @ApiOperation({ summary: 'Đổi vai trò (ADMIN). Không đổi được OWNER, không gán được OWNER' })
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
  @ApiOperation({ summary: 'Xóa thành viên (ADMIN) hoặc tự rời workspace' })
  @ApiNoContentResponse()
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', wsId()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ) {
    return this.workspaces.removeMember(user, id, userId, requestContext(req));
  }

  @Post(':wsId/transfer-ownership')
  @HttpCode(200)
  @ApiTags('members')
  @ApiOperation({ summary: 'Chuyển quyền OWNER cho thành viên khác (OWNER)' })
  @ApiZodBody(transferOwnershipBody)
  @ApiZodOk(z.array(memberSchema))
  transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', wsId()) id: string,
    @Body(new ZodValidationPipe(transferOwnershipBody))
    body: z.output<typeof transferOwnershipBody>,
    @Req() req: Request,
  ) {
    return this.workspaces.transferOwnership(user, id, body.userId, requestContext(req));
  }
}
