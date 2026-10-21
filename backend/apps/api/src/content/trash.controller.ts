import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { ApiZodOk } from '../common/swagger/zod-openapi.js';
import { userSummarySchema } from '../users/users.schemas.js';
import { nodeSchema, nodeTypeSchema } from './nodes.schemas.js';
import { TrashService } from './trash.service.js';

const uuid = () => new ParseUUIDPipe();

const trashItemSchema = z.object({
  id: z.uuid(),
  type: nodeTypeSchema,
  name: z.string(),
  parentId: z.uuid().nullable(),
  createdBy: userSummarySchema,
  deletedBy: userSummarySchema.nullable(),
  deletedAt: z.date(),
  itemCount: z.number().int().describe('Số mục bị xóa cùng lúc (kể cả chính nó)'),
});

const restoreResultSchema = z.object({
  node: nodeSchema.nullable().describe('null khi System Admin không phải thành viên workspace'),
  name: z.string().describe('Tên sau khi khôi phục'),
  movedToRoot: z.boolean().describe('true nếu folder cha cũ không còn nên khôi phục về gốc'),
  renamed: z.boolean().describe('true nếu trùng tên nên được đổi thành "Tên (1)"'),
});

@ApiTags('trash')
@ApiBearerAuth()
@Controller()
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get('workspaces/:wsId/trash')
  @ApiOperation({ summary: 'Thùng rác của workspace (EDITOR). Mỗi dòng là một lần xóa.' })
  @ApiZodOk(z.array(trashItemSchema))
  list(@CurrentUser() user: AuthenticatedUser, @Param('wsId', uuid()) wsId: string) {
    return this.trash.list(user, wsId);
  }

  @Post('nodes/:id/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Khôi phục (ADMIN mọi mục; EDITOR mục do mình xóa)',
    description: 'Folder cha không còn → khôi phục về gốc. Trùng tên → tự đổi thành "Tên (1)".',
  })
  @ApiZodOk(restoreResultSchema)
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.trash.restore(user, id, requestContext(req));
  }

  @Delete('nodes/:id/permanent')
  @HttpCode(204)
  @ApiOperation({ summary: 'Xóa vĩnh viễn một mục trong thùng rác (OWNER)' })
  @ApiNoContentResponse()
  deletePermanently(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.trash.deletePermanently(user, id, requestContext(req));
  }

  @Delete('workspaces/:wsId/trash')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dọn sạch thùng rác (OWNER)' })
  @ApiZodOk(z.object({ deleted: z.number().int() }))
  empty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Req() req: Request,
  ) {
    return this.trash.empty(user, wsId, requestContext(req));
  }
}
