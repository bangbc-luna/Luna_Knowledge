import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SystemAdmin } from '../auth/decorators/system-admin.decorator.js';
import { pageSchema } from '../common/pagination/cursor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodOk, ApiZodQuery } from '../common/swagger/zod-openapi.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminStatsService } from './admin-stats.service.js';
import { auditItemSchema, auditQuery, type AuditQuery, statsSchema } from './admin.schemas.js';

@ApiTags('admin')
@ApiBearerAuth()
@SystemAdmin()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly audit: AdminAuditService,
    private readonly stats: AdminStatsService,
  ) {}

  @Get('stats')
  @ApiOperation({
    summary: '[Admin] Số liệu tổng quan: người dùng, workspace, nội dung, hoạt động 7 ngày',
  })
  @ApiZodOk(statsSchema)
  overview() {
    return this.stats.overview();
  }

  @Get('audit-logs')
  @ApiOperation({
    summary: '[Admin] Nhật ký hoạt động toàn hệ thống',
    description:
      'Ai làm gì, trên đối tượng nào, lúc nào, từ IP nào. Mới nhất trước, phân trang cursor.',
  })
  @ApiZodQuery(auditQuery)
  @ApiZodOk(pageSchema(auditItemSchema))
  list(@Query(new ZodValidationPipe(auditQuery)) query: AuditQuery) {
    return this.audit.list(query);
  }

  @Get('audit-logs/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: '[Admin] Xuất nhật ký ra CSV (tối đa 10.000 dòng theo bộ lọc)' })
  @ApiProduces('text/csv')
  @ApiZodQuery(auditQuery)
  async export(
    @Query(new ZodValidationPipe(auditQuery)) query: AuditQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="nhat-ky-${date}.csv"`);
    return this.audit.exportCsv(query);
  }
}
