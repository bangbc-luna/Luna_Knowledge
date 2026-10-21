import { Module } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminStatsService } from './admin-stats.service.js';
import { AdminController } from './admin.controller.js';

@Module({ controllers: [AdminController], providers: [AdminAuditService, AdminStatsService] })
export class AdminModule {}
