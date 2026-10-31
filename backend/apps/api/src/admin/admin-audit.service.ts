import type { Prisma } from '@luna/db';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import type { AuditQuery } from './admin.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const EXPORT_LIMIT = 10_000;

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  private where(q: AuditQuery): Prisma.AuditLogWhereInput {
    return {
      actorId: q.actorId,
      action: q.actions ? { in: q.actions } : undefined,
      workspaceId: q.workspaceId,
      targetId: q.targetId,
      createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
  }

  async list(q: AuditQuery) {
    const rows = await this.prisma.client.auditLog.findMany({
      where: { ...this.where(q), id: q.cursor ? { lt: BigInt(q.cursor) } : undefined },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      items: await this.enrich(page),
      nextCursor: hasMore ? page[page.length - 1]!.id.toString() : null,
    };
  }

  async exportCsv(q: AuditQuery): Promise<string> {
    const rows = await this.prisma.client.auditLog.findMany({
      where: this.where(q),
      orderBy: { id: 'desc' },
      take: EXPORT_LIMIT,
    });
    const items = await this.enrich(rows);
    const header = [
      'Thời gian',
      'Người thực hiện',
      'Email',
      'Hành động',
      'Loại đối tượng',
      'Đối tượng',
      'Workspace',
      'IP',
      'Chi tiết',
    ];
    const lines = items.map((i) =>
      [
        i.createdAt.toISOString(),
        i.actor?.name ?? '',
        i.actor?.email ?? '',
        i.action,
        i.target?.type ?? '',
        i.target?.label ?? i.target?.id ?? '',
        i.workspace?.name ?? '',
        i.ip ?? '',
        i.metadata ? JSON.stringify(i.metadata) : '',
      ]
        .map(csvCell)
        .join(','),
    );
    return '﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n');
  }

  private async enrich(rows: Awaited<ReturnType<PrismaService['client']['auditLog']['findMany']>>) {
    const ids = (pick: (r: (typeof rows)[number]) => string | null | undefined) => [
      ...new Set(rows.map(pick).filter((v): v is string => !!v)),
    ];
    const targetIds = (type: string) => ids((r) => (r.targetType === type ? r.targetId : null));

    const [actors, workspaces, nodes, targetWorkspaces, targetUsers] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: ids((r) => r.actorId) } },
        select: userSummary,
      }),
      this.prisma.client.workspace.findMany({
        where: { id: { in: ids((r) => r.workspaceId) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.node.findMany({
        where: { id: { in: targetIds('node').filter(isUuid) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.workspace.findMany({
        where: { id: { in: targetIds('workspace').filter(isUuid) } },
        select: { id: true, name: true },
      }),
      this.prisma.client.user.findMany({
        where: { id: { in: targetIds('user').filter(isUuid) } },
        select: { id: true, email: true },
      }),
    ]);
    const actorMap = new Map(actors.map((a) => [a.id, a]));
    const wsMap = new Map(workspaces.map((w) => [w.id, w]));
    const labels = new Map<string, string>([
      ...nodes.map((n) => [`node:${n.id}`, n.name] as const),
      ...targetWorkspaces.map((w) => [`workspace:${w.id}`, w.name] as const),
      ...targetUsers.map((u) => [`user:${u.id}`, u.email] as const),
    ]);

    return rows.map((r) => {
      const meta = (r.metadata ?? null) as Record<string, unknown> | null;
      const fallback =
        typeof meta?.name === 'string'
          ? meta.name
          : typeof meta?.email === 'string'
            ? meta.email
            : null;
      return {
        id: r.id.toString(),
        createdAt: r.createdAt,
        action: r.action,
        actor: r.actorId ? (actorMap.get(r.actorId) ?? null) : null,
        target:
          r.targetType && r.targetId
            ? {
                type: r.targetType,
                id: r.targetId,
                label: labels.get(`${r.targetType}:${r.targetId}`) ?? fallback,
              }
            : null,
        workspace: r.workspaceId ? (wsMap.get(r.workspaceId) ?? null) : null,
        metadata: r.metadata ?? null,
        ip: r.ip,
        userAgent: r.userAgent,
      };
    });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID_RE.test(v);

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
