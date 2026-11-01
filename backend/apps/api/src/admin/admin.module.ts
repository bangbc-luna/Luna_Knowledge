import { Module } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminStatsService } from './admin-stats.service.js';
import { MeetingUsageService } from './meeting-usage.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  controllers: [AdminController],
  providers: [AdminAuditService, AdminStatsService, MeetingUsageService],
})
export class AdminModule {}
