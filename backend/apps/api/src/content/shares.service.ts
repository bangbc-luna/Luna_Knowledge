import { Prisma } from '@luna/db';
import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CollabEventsService } from '../infra/redis/collab-events.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UsersService } from '../users/users.service.js';
import { ContentAccessService } from './content-access.service.js';
import type { CreateShareBody } from './shares.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const shareSelect = {
  id: true,
  role: true,
  createdAt: true,
  user: { select: userSummary },
  grantedBy: { select: userSummary },
} as const;

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly search: SearchQueueService,
    private readonly collab: CollabEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, nodeId: string) {
    await this.requireManager(user, nodeId);
    const ancestors = await this.prisma.client.$queryRaw<{ id: string; name: string }[]>`
      SELECT a.id, a.name FROM nodes a
       WHERE a.path @> (SELECT path FROM nodes WHERE id = ${nodeId}::uuid) AND a.id <> ${nodeId}::uuid`;
    const shares = await this.prisma.client.nodeShare.findMany({
      where: { nodeId: { in: [nodeId, ...ancestors.map((a) => a.id)] } },
      select: { ...shareSelect, nodeId: true },
      orderBy: { createdAt: 'asc' },
    });
    const names = new Map(ancestors.map((a) => [a.id, a.name]));
    return {
      direct: shares.filter((s) => s.nodeId === nodeId).map(({ nodeId: _n, ...s }) => s),
      inherited: shares
        .filter((s) => s.nodeId !== nodeId)
        .map(({ nodeId: from, ...s }) => ({
          ...s,
          fromNode: { id: from, name: names.get(from)! },
        })),
    };
  }

  async create(
    user: AuthenticatedUser,
    nodeId: string,
    body: CreateShareBody,
    ctx: RequestContext,
  ) {
    const node = await this.requireManager(user, nodeId);
    const target = await this.users.findOrProvision(body.email);
    try {
      const share = await this.prisma.client.nodeShare.create({
        data: { nodeId, userId: target.id, role: body.role, grantedById: user.id },
        select: shareSelect,
      });
      await this.auditShare(
        user,
        'share.add',
        node.workspaceId,
        nodeId,
        {
          userId: target.id,
          email: target.email,
          role: body.role,
        },
        ctx,
      );
      if (target.id !== user.id) {
        await this.notifications.notify([target.id], 'share.added', {
          nodeId,
          nodeName: node.name,
          nodeType: node.type,
          workspaceId: node.workspaceId,
          role: body.role,
          byName: user.name,
        });
      }
      return share;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict(
          'This item is already shared with this user; update the role instead',
        );
      }
      throw err;
    }
  }

  async update(
    user: AuthenticatedUser,
    nodeId: string,
    shareId: string,
    role: 'EDITOR' | 'VIEWER',
    ctx: RequestContext,
  ) {
    const node = await this.requireManager(user, nodeId);
    const existing = await this.findShare(nodeId, shareId);
    const share = await this.prisma.client.nodeShare.update({
      where: { id: shareId },
      data: { role },
      select: shareSelect,
    });
    await this.auditShare(
      user,
      'share.update',
      node.workspaceId,
      nodeId,
      {
        userId: existing.userId,
        from: existing.role,
        to: role,
      },
      ctx,
    );
    await this.collab.accessChanged({ workspaceId: node.workspaceId, userId: existing.userId });
    return share;
  }

  async remove(user: AuthenticatedUser, nodeId: string, shareId: string, ctx: RequestContext) {
    const node = await this.requireManager(user, nodeId);
    const existing = await this.findShare(nodeId, shareId);
    await this.prisma.client.nodeShare.delete({ where: { id: shareId } });
    await this.auditShare(
      user,
      'share.remove',
      node.workspaceId,
      nodeId,
      {
        userId: existing.userId,
        role: existing.role,
      },
      ctx,
    );
    await this.collab.accessChanged({ workspaceId: node.workspaceId, userId: existing.userId });
  }

  private async requireManager(user: AuthenticatedUser, nodeId: string) {
    return this.access.requireNode(user, nodeId, 'OWNER');
  }

  private async findShare(nodeId: string, shareId: string) {
    const share = await this.prisma.client.nodeShare.findFirst({ where: { id: shareId, nodeId } });
    if (!share) throw AppError.notFound('Share not found');
    return share;
  }

  private async auditShare(
    user: AuthenticatedUser,
    action: string,
    workspaceId: string,
    nodeId: string,
    metadata: Prisma.InputJsonObject,
    ctx: RequestContext,
  ) {
    await this.audit.log({
      actorId: user.id,
      action,
      targetType: 'node',
      targetId: nodeId,
      workspaceId,
      metadata,
      ctx,
    });
    await this.search.tree(nodeId);
  }
}
