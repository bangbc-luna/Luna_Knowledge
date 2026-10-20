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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { requestContext } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodCreated, ApiZodOk } from '../common/swagger/zod-openapi.js';
import {
  createShareBody,
  type CreateShareBody,
  nodeSharesSchema,
  shareSchema,
  updateShareBody,
} from './shares.schemas.js';
import { SharesService } from './shares.service.js';

const uuid = () => new ParseUUIDPipe();

@ApiTags('shares')
@ApiBearerAuth()
@Controller('nodes/:id/shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Get()
  @ApiOperation({ summary: 'Share trực tiếp và kế thừa của mục (ADMIN workspace)' })
  @ApiZodOk(nodeSharesSchema)
  list(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.shares.list(user, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Share cho một người theo email (ADMIN workspace)',
    description: 'Quyền được kế thừa xuống mọi mục con; chỉ cộng thêm quyền, không bớt.',
  })
  @ApiZodBody(createShareBody)
  @ApiZodCreated(shareSchema)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(createShareBody)) body: CreateShareBody,
    @Req() req: Request,
  ) {
    return this.shares.create(user, id, body, requestContext(req));
  }

  @Patch(':shareId')
  @ApiOperation({ summary: 'Đổi quyền share (ADMIN workspace)' })
  @ApiZodBody(updateShareBody)
  @ApiZodOk(shareSchema)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('shareId', uuid()) shareId: string,
    @Body(new ZodValidationPipe(updateShareBody)) body: z.output<typeof updateShareBody>,
    @Req() req: Request,
  ) {
    return this.shares.update(user, id, shareId, body.role, requestContext(req));
  }

  @Delete(':shareId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Thu hồi share (ADMIN workspace)' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid()) id: string,
    @Param('shareId', uuid()) shareId: string,
    @Req() req: Request,
  ) {
    return this.shares.remove(user, id, shareId, requestContext(req));
  }
}
