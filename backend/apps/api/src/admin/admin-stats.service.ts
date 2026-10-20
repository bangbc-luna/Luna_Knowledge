import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service.js';

const DAY = 24 * 3600_000;

/** Số liệu cho màn Tổng quan của trang admin. */
@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const db = this.prisma.client;
    const since = new Date(Date.now() - 7 * DAY);
    const [
      users,
      disabled,
      admins,
      workspaces,
      byType,
      inTrash,
      activeUsers,
      logins,
      failed,
      daily,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { status: 'DISABLED' } }),
      db.user.count({ where: { isSystemAdmin: true } }),
      db.workspace.count({ where: { deletedAt: null } }),
      db.node.groupBy({ by: ['type'], where: { deletedAt: null }, _count: { _all: true } }),
      db.node.count({ where: { deletedAt: { not: null } } }),
      db.auditLog.findMany({
        where: { createdAt: { gte: since }, actorId: { not: null } },
        distinct: ['actorId'],
        select: { actorId: true },
      }),
      db.auditLog.count({ where: { action: 'auth.login', createdAt: { gte: since } } }),
      db.auditLog.count({ where: { action: 'auth.login_failed', createdAt: { gte: since } } }),
      db.$queryRaw<{ day: string; count: bigint }[]>`
          SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS day,
                 count(*) AS count
            FROM audit_logs
           WHERE created_at >= ${since}
           GROUP BY 1`,
    ]);

    const typeCount = (t: string) => byType.find((b) => b.type === t)?._count._all ?? 0;
    const counts = new Map(daily.map((d) => [d.day, Number(d.count)]));
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * DAY);
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
      return { date: key, count: counts.get(key) ?? 0 };
    });

    return {
      users: {
        total: users,
        active: users - disabled,
        disabled,
        systemAdmins: admins,
        activeLast7Days: activeUsers.length,
      },
      workspaces: { total: workspaces },
      content: {
        folders: typeCount('FOLDER'),
        documents: typeCount('DOCUMENT'),
        files: typeCount('FILE'),
        videos: typeCount('VIDEO'),
        inTrash,
      },
      activity: { last7Days, loginsLast7Days: logins, failedLoginsLast7Days: failed },
    };
  }
}
