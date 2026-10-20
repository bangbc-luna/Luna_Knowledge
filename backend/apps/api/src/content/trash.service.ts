import { JOBS, QUEUES } from '@luna/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { roleAtLeast } from '../workspaces/workspace-roles.js';
import { ContentAccessService } from './content-access.service.js';
import { NodeDtoService } from './node-dto.service.js';
import { nameKey, suggestName } from './node-names.js';
import { NodesService } from './nodes.service.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;

/**
 * Thùng rác (SPEC §7.6). Mỗi lần xóa tạo một "mục gốc" (deleted_root_id = id);
 * khôi phục/xóa vĩnh viễn luôn thao tác trên mục gốc cùng cả nhánh của nó.
 */
@Injectable()
export class TrashService {
  private readonly logger = new Logger(TrashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly nodes: NodesService,
    private readonly dto: NodeDtoService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.MAINTENANCE) private readonly maintenance: Queue,
  ) {}

  async list(user: AuthenticatedUser, workspaceId: string) {
    await this.access.requireMember(user, workspaceId, 'EDITOR');
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

  /**
   * Khôi phục về vị trí cũ; nếu folder cha không còn (đã xóa) thì về gốc workspace.
   * Trùng tên ở nơi khôi phục thì tự đổi tên ("Tên (1)").
   * ADMIN trở lên khôi phục mọi mục; EDITOR chỉ khôi phục mục do mình xóa.
   */
  async restore(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireTrashRoot(user, nodeId, 'EDITOR');
    if (!roleAtLeast(node.memberRole, 'ADMIN') && node.deletedById !== user.id) {
      throw AppError.forbidden('Editors can only restore items they deleted');
    }

    const result = await this.prisma.client.$transaction(async (tx) => {
      const parent = node.parentId
        ? await tx.node.findUnique({ where: { id: node.parentId }, select: { deletedAt: true } })
        : null;
      const parentId = parent && !parent.deletedAt ? node.parentId : null;

      const taken = await this.nodes.siblingKeys(node.workspaceId, parentId);
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
    return {
      node: await this.dto.one(user.id, nodeId),
      movedToRoot: result.parentId !== node.parentId,
      renamed: result.name !== node.name,
    };
  }

  /** Xóa vĩnh viễn một mục gốc và cả nhánh (FK parent_id ON DELETE CASCADE). Chỉ OWNER. */
  async deletePermanently(user: AuthenticatedUser, nodeId: string, ctx: RequestContext) {
    const node = await this.requireTrashRoot(user, nodeId, 'OWNER');
    await this.prisma.client.node.delete({ where: { id: nodeId } });
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
    await this.access.requireMember(user, workspaceId, 'OWNER');
    const count = await this.prisma.client.$executeRaw`
      DELETE FROM nodes WHERE workspace_id = ${workspaceId}::uuid AND deleted_root_id = id`;
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

  /**
   * Xóa DB xong thì nhờ worker dọn object ngay (trigger đã ghi danh sách vào `blob_gc`).
   * Không đẩy được job cũng không sao: lịch GC 10 phút sẽ dọn.
   */
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

  /** Mục phải đang nằm trong thùng rác và là mục gốc; thao tác thùng rác chỉ dành cho thành viên. */
  private async requireTrashRoot(user: AuthenticatedUser, nodeId: string, min: 'EDITOR' | 'OWNER') {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER', { allowDeleted: true });
    if (!node.deletedAt) throw AppError.validation('Item is not in the trash');
    if (node.deletedRootId !== node.id) {
      throw AppError.validation('Restore or delete the parent folder that was deleted');
    }
    if (!roleAtLeast(node.memberRole, min)) {
      throw AppError.forbidden(`Requires ${min} role in this workspace`);
    }
    return node;
  }
}
