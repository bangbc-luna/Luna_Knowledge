import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { SystemAdmin } from '../auth/decorators/system-admin.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { pageSchema } from '../common/pagination/cursor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import {
  adminListUsersQuery,
  type AdminListUsersQuery,
  adminUpdateUserBody,
  type AdminUpdateUserBody,
  adminUserSchema,
  meSchema,
  searchUsersQuery,
  userSummarySchema,
} from './users.schemas.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Thông tin user hiện tại và các workspace kèm vai trò' })
  @ApiZodOk(meSchema)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.me(user);
  }

  @Get('users')
  @ApiOperation({ summary: 'Tìm user đang hoạt động (chọn người khi share/thêm thành viên)' })
  @ApiZodQuery(searchUsersQuery)
  @ApiZodOk(z.array(userSummarySchema))
  search(@Query(new ZodValidationPipe(searchUsersQuery)) query: z.output<typeof searchUsersQuery>) {
    return this.users.search(query.q, query.limit);
  }

  @Get('users/admins')
  @ApiOperation({
    summary: 'Quản trị hệ thống đang hoạt động (người cần liên hệ để được thêm vào workspace)',
  })
  @ApiZodOk(z.array(userSummarySchema))
  admins() {
    return this.users.systemAdmins();
  }

  @Get('admin/users')
  @SystemAdmin()
  @ApiTags('admin')
  @ApiOperation({ summary: '[Admin] Danh sách user' })
  @ApiZodQuery(adminListUsersQuery)
  @ApiZodOk(pageSchema(adminUserSchema))
  adminList(@Query(new ZodValidationPipe(adminListUsersQuery)) query: AdminListUsersQuery) {
    return this.users.adminList(query);
  }

  @Patch('admin/users/:id')
  @SystemAdmin()
  @ApiTags('admin')
  @ApiOperation({
    summary: '[Admin] Khóa/mở khóa user, cấp/gỡ quyền System Admin',
    description:
      'Khóa user sẽ thu hồi ngay mọi phiên đăng nhập của họ. Không áp dụng cho chính mình.',
  })
  @ApiZodBody(adminUpdateUserBody)
  @ApiZodOk(adminUserSchema)
  adminUpdate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminUpdateUserBody)) body: AdminUpdateUserBody,
    @Req() req: Request,
  ) {
    return this.users.adminUpdate(actor, id, body, requestContext(req));
  }
}
