import type { Prisma } from '@luna/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';

/** Một người mở lại cùng một mục trong khoảng này chỉ ghi một lượt xem (log không bị ngập). */
const VIEW_DEDUPE_SEC = 300;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  workspaceId?: string;
  metadata?: Prisma.InputJsonValue;
  ctx?: RequestContext;
}

/**
 * Ghi audit log (SPEC AUDIT-1..2). Ghi thẳng vào DB: lượng log nhỏ (<200 user).
 * Lỗi ghi log không được làm hỏng thao tác chính, nên chỉ ghi lại lỗi.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Ghi lượt xem mục (thư mục, tài liệu, tệp, video): ai truy cập cái gì (trang admin, Nhật ký). */
  async logView(
    actorId: string,
    node: { id: string; type: string; name: string; workspaceId: string },
    ctx?: RequestContext,
  ): Promise<void> {
    try {
      const fresh = await this.redis.set(
        `audit:view:${actorId}:${node.id}`,
        '1',
        'EX',
        VIEW_DEDUPE_SEC,
        'NX',
      );
      if (!fresh) return;
    } catch {
      // Redis lỗi thì vẫn ghi (thà trùng còn hơn mất dấu truy cập).
    }
    await this.log({
      actorId,
      action: 'node.view',
      targetType: 'node',
      targetId: node.id,
      workspaceId: node.workspaceId,
      metadata: { type: node.type, name: node.name },
      ctx,
    });
  }

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          workspaceId: entry.workspaceId,
          metadata: entry.metadata,
          ip: entry.ctx?.ip,
          userAgent: entry.ctx?.userAgent,
        },
      });
    } catch (err) {
      this.logger.error({ err, action: entry.action }, 'Failed to write audit log');
    }
  }
}
