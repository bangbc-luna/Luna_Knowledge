import { JOBS, QUEUES } from '@luna/shared';
import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { ContentAccessService } from './content-access.service.js';
import { NodeDtoService } from './node-dto.service.js';
import { nameKey, suggestName } from './node-names.js';
import { NodesService } from './nodes.service.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;

@Injectable()
export class TrashService {
  private readonly logger = new Logger(TrashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly nodes: NodesService,
    private readonly dto: NodeDtoService,
    private readonly audit: AuditService,
    private readonly search: SearchQueueService,
    @InjectQueue(QUEUES.MAINTENANCE) private readonly maintenance: Queue,
  ) {}

  async list(user: AuthenticatedUser, workspaceId: string) {
    if (!user.isSystemAdmin) await this.access.requireMember(user, workspaceId, 'MEMBER');
    const roots = await this.prisma.client.$queryRaw<{ id: string; item_count: bigint }[]>`
      SELECT r.id, (SELECT count(*) FROM nodes d WHERE d.deleted_root_id = r.id) AS item_count
        FROM nodes r
       WHERE r.workspace_id = ${workspaceId}::uuid AND r.deleted_root_id = r.id
       ORDER BY r.deleted_at DESC`;
    if (roots.length === 0) return [];
    const nodes = await this.prisma.client.node.findMany({
      where: { id: { in: roots.map((r) => r.id) } },
      include: { deletedBy: { select: userSummary }, createdBy: { select: userSummary } },
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return roots.map((r) => {
      const n = byId.get(r.id)!;
      return {
        id: n.id,
        type: n.type,
        name: n.name,
        parentId: n.parentId,
        createdBy: n.createdBy,
        deletedBy: n.deletedBy,
        deletedAt: n.deletedAt!,
        itemCount: Number(r.item_count),
      };
    });
  }

  async restore(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireTrashRoot(user, nodeId);
    if (!user.isSystemAdmin && node.deletedById !== user.id && node.memberRole !== 'ADMIN') {
      throw AppError.forbidden(
        'Only the person who deleted this item, a workspace admin or a system admin can restore it',
      );
    }

    const result = await this.nodes.withTreeLock(node.workspaceId, async (tx) => {
      const [current] = await tx.$queryRaw<{ deleted_root_id: string | null }[]>`
        SELECT deleted_root_id FROM nodes WHERE id = ${nodeId}::uuid FOR UPDATE`;
      if (!current) throw AppError.notFound('Item not found');
      if (current.deleted_root_id !== nodeId) {
        throw AppError.validation('Item is not in the trash');
      }
      const [parent] = node.parentId
        ? await tx.$queryRaw<{ deleted_at: Date | null }[]>`
            SELECT deleted_at FROM nodes WHERE id = ${node.parentId}::uuid FOR SHARE`
        : [];
      const parentId = parent && !parent.deleted_at ? node.parentId : null;

      const taken = await this.nodes.siblingKeys(
        node.workspaceId,
        parentId,
        undefined,
        node.section,
        tx,
      );
      const name = taken.has(nameKey(node.name)) ? suggestName(node.name, taken) : node.name;

      await tx.node.update({
        where: { id: nodeId },
        data: { parentId, name, nameNormalized: nameKey(name), updatedById: user.id },
      });
      await tx.node.updateMany({
        where: { deletedRootId: nodeId },
        data: { deletedAt: null, deletedById: null, deletedRootId: null },
      });
      return { parentId, name };
    });

    await this.audit.log({
      actorId: user.id,
      action: 'node.restore',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: {
        restoredTo: result.parentId,
        movedToRoot: result.parentId !== node.parentId,
        renamedTo: result.name !== node.name ? result.name : undefined,
      },
      ctx,
    });
    await this.search.tree(nodeId);
    return {
      node: (await this.dto.one(user.id, nodeId)) ?? null,
      name: result.name,
      movedToRoot: result.parentId !== node.parentId,
      renamed: result.name !== node.name,
    };
  }

  async deletePermanently(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireTrashRoot(user, nodeId);
    if (!user.isSystemAdmin && node.memberRole !== 'ADMIN') {
      throw AppError.forbidden('Only a workspace admin can delete permanently');
    }
    await this.nodes.withTreeLock(node.workspaceId, async (tx) => {
      const { count } = await tx.node.deleteMany({ where: { id: nodeId, deletedRootId: nodeId } });
      if (count > 0) return;
      const current = await tx.node.findUnique({ where: { id: nodeId }, select: { id: true } });
      if (!current) throw AppError.notFound('Item not found');
      throw AppError.validation('Item is not in the trash');
    });
    await this.collectGarbageSoon();
    await this.audit.log({
      actorId: user.id,
      action: 'node.delete_permanent',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, type: node.type },
      ctx,
    });
  }

  async empty(user: AuthenticatedUser, workspaceId: string, ctx: RequestContext) {
    if (!user.isSystemAdmin) await this.access.requireMember(user, workspaceId, 'ADMIN');
    const count = await this.nodes.withTreeLock(
      workspaceId,
      (tx) => tx.$executeRaw`
        DELETE FROM nodes WHERE workspace_id = ${workspaceId}::uuid AND deleted_root_id = id`,
    );
    await this.collectGarbageSoon();
    await this.audit.log({
      actorId: user.id,
      action: 'trash.empty',
      targetType: 'workspace',
      targetId: workspaceId,
      workspaceId,
      metadata: { deletedRoots: count },
      ctx,
    });
    return { deleted: count };
  }

  private async collectGarbageSoon() {
    try {
      await this.maintenance.add(
        JOBS.BLOB_GC,
        {},
        {
          jobId: 'blob-gc-now',
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.logger.warn({ err }, 'Could not enqueue blob GC');
    }
  }

  private async requireTrashRoot(user: AuthenticatedUser, nodeId: string) {
    const node = (await this.access.resolveMany(user.id, [nodeId])).get(nodeId);
    if (!node || (!node.isMember && !user.isSystemAdmin)) throw AppError.notFound('Item not found');
    if (!node.deletedAt) throw AppError.validation('Item is not in the trash');
    if (node.deletedRootId !== node.id) {
      throw AppError.validation('Restore or delete the parent folder that was deleted');
    }
    return node;
  }
}
