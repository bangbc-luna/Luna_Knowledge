import { Module } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminStatsService } from './admin-stats.service.js';
import { AdminController } from './admin.controller.js';

/** Trang admin (System Admin): số liệu tổng quan và nhật ký hoạt động. */
@Module({ controllers: [AdminController], providers: [AdminAuditService, AdminStatsService] })
export class AdminModule {}
