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
import { pageSchema } from '../common/pagination/cursor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import {
  breadcrumbSchema,
  createFolderBody,
  type CreateFolderBody,
  activityQuery,
  activitySchema,
  listNodesQuery,
  type ListNodesQuery,
  moveNodeBody,
  nodeSchema,
  renameNodeBody,
  sharedWithMeSchema,
} from './nodes.schemas.js';
import { NodesService } from './nodes.service.js';

const uuid = () => new ParseUUIDPipe();

@ApiTags('nodes')
@ApiBearerAuth()
@Controller()
export class NodesController {
  constructor(private readonly nodes: NodesService) {}

  @Get('workspaces/:wsId/nodes')
  @ApiOperation({
    summary: 'Liệt kê mục con của một folder (hoặc gốc workspace)',
    description: 'Folder luôn đứng trước. Gốc workspace chỉ dành cho thành viên.',
  })
  @ApiZodQuery(listNodesQuery)
  @ApiZodOk(pageSchema(nodeSchema))
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Query(new ZodValidationPipe(listNodesQuery)) query: ListNodesQuery,
  ) {
    return this.nodes.list(user, wsId, query);
  }

  @Post('workspaces/:wsId/folders')
  @ApiOperation({
    summary: 'Tạo folder (EDITOR)',
    description: 'Trùng tên trong cùng folder → 409 kèm `details.suggestion`.',
  })
  @ApiZodBody(createFolderBody)
  @ApiZodCreated(nodeSchema)
  createFolder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('wsId', uuid()) wsId: string,
    @Body(new ZodValidationPipe(createFolderBody)) body: CreateFolderBody,
    @Req() req: Request,
  ) {
    return this.nodes.createFolder(user, wsId, body, requestContext(req));
  }

  @Get('nodes/:id')
  @ApiOperation({ summary: 'Chi tiết mục (VIEWER)' })
  @ApiZodOk(nodeSchema)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.nodes.get(user, id, requestContext(req));
  }

  @Get('nodes/:id/activity')
  @ApiOperation({
    summary:
      'Hoạt động trên mục: ai sửa nội dung, đổi tên, di chuyển, tải bản mới (người sở hữu, share chỉnh sửa, System Admin)',
  })
  @ApiZodQuery(activityQuery)
  @ApiZodOk(activitySchema)
  activity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(activityQuery)) q: z.output<typeof activityQuery>,
  ) {
    return this.nodes.activity(user, id, q);
  }

  @Get('nodes/:id/breadcrumb')
  @ApiOperation({
    summary: 'Đường dẫn từ gốc tới mục (người được share chỉ thấy từ folder được share)',
  })
  @ApiZodOk(breadcrumbSchema)
  breadcrumb(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.nodes.breadcrumb(user, id);
  }

  @Patch('nodes/:id')
  @ApiOperation({ summary: 'Đổi tên (EDITOR)' })
  @ApiZodBody(renameNodeBody)
  @ApiZodOk(nodeSchema)
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(renameNodeBody)) body: z.output<typeof renameNodeBody>,
    @Req() req: Request,
  ) {
    return this.nodes.rename(user, id, body.name, requestContext(req));
  }

  @Post('nodes/:id/move')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Di chuyển trong cùng workspace (EDITOR ở cả nguồn và đích)',
    description: 'Không di chuyển folder vào chính nó hoặc folder con của nó.',
  })
  @ApiZodBody(moveNodeBody)
  @ApiZodOk(nodeSchema)
  move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(moveNodeBody)) body: z.output<typeof moveNodeBody>,
    @Req() req: Request,
  ) {
    return this.nodes.move(user, id, body.targetParentId, requestContext(req));
  }

  @Delete('nodes/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Đưa vào thùng rác cùng cả nhánh',
    description: 'ADMIN trở lên xóa mọi mục; EDITOR chỉ xóa mục do mình tạo.',
  })
  @ApiNoContentResponse()
  trash(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Req() req: Request,
  ) {
    return this.nodes.trash(user, id, requestContext(req));
  }

  @Get('shared-with-me')
  @ApiOperation({ summary: 'Các mục được share trực tiếp cho tôi' })
  @ApiZodOk(z.array(sharedWithMeSchema))
  sharedWithMe(@CurrentUser() user: AuthenticatedUser) {
    return this.nodes.sharedWithMe(user);
  }
}
