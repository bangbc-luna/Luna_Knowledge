import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { SystemAdmin } from '../auth/decorators/system-admin.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import { type SearchQuery, searchQuery, searchResultSchema } from './search.schemas.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@ApiBearerAuth()
@Controller()
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly queue: SearchQueueService,
  ) {}

  @Get('search')
  @ApiOperation({
    summary:
      'Tìm toàn văn theo tên, nội dung tài liệu, chữ trích từ file và tag; chỉ trả mục bạn có quyền xem',
  })
  @ApiZodQuery(searchQuery)
  @ApiZodOk(searchResultSchema)
  find(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(searchQuery)) q: SearchQuery,
  ) {
    return this.search.search(user, q);
  }

  @Post('admin/search/reindex')
  @HttpCode(202)
  @SystemAdmin()
  @ApiOperation({ summary: '[Admin] Dựng lại toàn bộ chỉ mục tìm kiếm (chạy nền)' })
  @ApiZodOk(z.object({ queued: z.boolean() }))
  async reindex() {
    await this.queue.reindexAll();
    return { queued: true };
  }
}
