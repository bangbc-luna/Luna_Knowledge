import type { NodeType, Prisma } from '@luna/db';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import type { Page } from '../common/pagination/cursor.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { roleAtLeast } from '../workspaces/workspace-roles.js';
import { isNameConflict } from './conflicts.js';
import { ContentAccessService, type NodeAccess } from './content-access.service.js';
import { NodeDtoService } from './node-dto.service.js';
import { nameKey, suggestName } from './node-names.js';
import type { CreateFolderBody, ListNodesQuery, NodeDto } from './nodes.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;

/** Cursor của danh sách con: vị trí (offset) đã mã hóa. Folder thường chỉ vài trăm mục. */
const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString('base64url');
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString());
  if (!Number.isInteger(n) || n < 0) throw AppError.validation('Invalid cursor');
  return n;
}

@Injectable()
export class NodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly dto: NodeDtoService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- Đọc

  async list(
    user: AuthenticatedUser,
    workspaceId: string,
    q: ListNodesQuery,
  ): Promise<Page<NodeDto>> {
    if (q.parentId) {
      const parent = await this.access.requireNode(user, q.parentId, 'VIEWER');
      if (parent.workspaceId !== workspaceId) throw AppError.notFound('Item not found');
      if (parent.type !== 'FOLDER') throw AppError.validation('parentId must be a folder');
    } else {
      // Gốc workspace chỉ dành cho thành viên; người được share đi vào từ "Được chia sẻ với tôi".
      await this.access.requireMember(user, workspaceId, 'VIEWER');
    }

    const offset = decodeCursor(q.cursor);
    const sortBy: Prisma.NodeOrderByWithRelationInput =
      q.sort === 'name'
        ? { nameNormalized: q.order }
        : q.sort === 'updatedAt'
          ? { updatedAt: q.order }
          : { createdAt: q.order };
    const rows = await this.prisma.client.node.findMany({
      where: {
        workspaceId,
        parentId: q.parentId ?? null,
        deletedAt: null,
        type: q.type,
        // File đang tải lên dở chỉ người tải thấy.
        OR: [{ status: { not: 'UPLOADING' } }, { createdById: user.id }],
      },
      // Folder luôn đứng trước (enum NodeType khai báo FOLDER đầu tiên).
      orderBy: [{ type: 'asc' }, sortBy, { id: 'asc' }],
      select: { id: true },
      skip: offset,
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const ids = rows.slice(0, q.limit).map((r) => r.id);
    return {
      items: await this.dto.build(user.id, ids),
      nextCursor: hasMore ? encodeCursor(offset + q.limit) : null,
    };
  }

  /** Mở chi tiết node; ghi "mở gần đây" với tài liệu/file/video (không ghi với folder). */
  async get(user: AuthenticatedUser, nodeId: string, ctx?: RequestContext): Promise<NodeDto> {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER');
    await this.audit.logView(user.id, node, ctx);
    if (node.type !== 'FOLDER') {
      await this.prisma.client.recentView.upsert({
        where: { userId_nodeId: { userId: user.id, nodeId } },
        create: { userId: user.id, nodeId },
        update: { viewedAt: new Date() },
      });
    }
    return this.dto.one(user.id, nodeId);
  }

  /**
   * Đường dẫn từ gốc tới node. Người chỉ có quyền qua share chỉ thấy từ folder được share trở xuống
   * (không lộ tên các folder cha mà họ không có quyền).
   */
  async breadcrumb(user: AuthenticatedUser, nodeId: string) {
    const node = await this.access.requireNode(user, nodeId, 'VIEWER');
    const rows = await this.prisma.client.$queryRaw<
      { id: string; name: string; type: NodeType; shared: boolean }[]
    >`
      SELECT a.id, a.name, a.type,
             EXISTS (SELECT 1 FROM node_shares s WHERE s.node_id = a.id AND s.user_id = ${user.id}::uuid) AS shared
        FROM nodes a
       WHERE a.path @> (SELECT path FROM nodes WHERE id = ${nodeId}::uuid)
       ORDER BY nlevel(a.path)`;
    const start = node.memberRole
      ? 0
      : Math.max(
          0,
          rows.findIndex((r) => r.shared),
        );
    return rows.slice(start).map(({ id, name, type }) => ({ id, name, type }));
  }

  /** Các node được share trực tiếp cho tôi (node và workspace còn hoạt động). */
  async sharedWithMe(user: AuthenticatedUser) {
    const shares = await this.prisma.client.nodeShare.findMany({
      where: { userId: user.id, node: { deletedAt: null, workspace: { deletedAt: null } } },
      include: {
        grantedBy: { select: userSummary },
        node: { select: { workspace: { select: { id: true, name: true, slug: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const dtos = await this.dto.build(
      user.id,
      shares.map((s) => s.nodeId),
    );
    const byId = new Map(dtos.map((d) => [d.id, d]));
    return shares.flatMap((s) => {
      const node = byId.get(s.nodeId);
      return node
        ? [
            {
              node,
              shareRole: s.role,
              sharedBy: s.grantedBy,
              sharedAt: s.createdAt,
              workspace: s.node.workspace,
            },
          ]
        : [];
    });
  }

  // ---------------------------------------------------------------- Ghi

  async createFolder(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateFolderBody,
    ctx: RequestContext,
  ): Promise<NodeDto> {
    const parentId = body.parentId ?? null;
    await this.requireContainer(user, workspaceId, parentId);
    try {
      const node = await this.prisma.client.node.create({
        data: {
          workspaceId,
          parentId,
          type: 'FOLDER',
          name: body.name,
          nameNormalized: nameKey(body.name),
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await this.audit.log({
        actorId: user.id,
        action: 'node.create',
        targetType: 'node',
        targetId: node.id,
        workspaceId,
        metadata: { type: 'FOLDER', name: body.name, parentId },
        ctx,
      });
      return this.dto.one(user.id, node.id);
    } catch (err) {
      throw await this.mapNameConflict(err, workspaceId, parentId, body.name);
    }
  }

  async rename(
    user: AuthenticatedUser,
    nodeId: string,
    name: string,
    ctx: RequestContext,
  ): Promise<NodeDto> {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR');
    try {
      await this.prisma.client.node.update({
        where: { id: nodeId },
        data: { name, nameNormalized: nameKey(name), updatedById: user.id },
      });
    } catch (err) {
      throw await this.mapNameConflict(err, node.workspaceId, node.parentId, name, nodeId);
    }
    await this.audit.log({
      actorId: user.id,
      action: 'node.rename',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { from: node.name, to: name },
      ctx,
    });
    return this.dto.one(user.id, nodeId);
  }

  /** Di chuyển trong cùng workspace. Cần quyền EDITOR ở cả node lẫn folder đích. */
  async move(
    user: AuthenticatedUser,
    nodeId: string,
    targetParentId: string | null,
    ctx: RequestContext,
  ): Promise<NodeDto> {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR');
    if (targetParentId === node.id) throw AppError.validation('Cannot move an item into itself');
    await this.requireContainer(user, node.workspaceId, targetParentId);
    if (targetParentId === node.parentId) return this.dto.one(user.id, nodeId);

    try {
      await this.prisma.client.$transaction(async (tx) => {
        // Khóa node để hai thao tác di chuyển đồng thời không tạo vòng lặp.
        await tx.$queryRaw`SELECT id FROM nodes WHERE id = ${nodeId}::uuid FOR UPDATE`;
        if (targetParentId) {
          const [{ inside }] = await tx.$queryRaw<{ inside: boolean }[]>`
            SELECT (t.path <@ n.path) AS inside
              FROM nodes t, nodes n
             WHERE t.id = ${targetParentId}::uuid AND n.id = ${nodeId}::uuid`;
          if (inside) throw AppError.validation('Cannot move a folder into its own subfolder');
        }
        await tx.node.update({
          where: { id: nodeId },
          data: { parentId: targetParentId, updatedById: user.id },
        });
      });
    } catch (err) {
      throw await this.mapNameConflict(err, node.workspaceId, targetParentId, node.name, nodeId);
    }

    await this.audit.log({
      actorId: user.id,
      action: 'node.move',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { from: node.parentId, to: targetParentId },
      ctx,
    });
    return this.dto.one(user.id, nodeId);
  }

  /**
   * Đưa node và cả nhánh vào thùng rác (SPEC NODE-5). ADMIN trở lên xóa mọi thứ;
   * EDITOR chỉ xóa mục do mình tạo.
   */
  async trash(user: AuthenticatedUser, nodeId: string, ctx: RequestContext): Promise<void> {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR');
    this.assertCanDelete(user, node);
    const count = await this.prisma.client.$executeRaw`
      UPDATE nodes
         SET deleted_at = now(), deleted_by = ${user.id}::uuid, deleted_root_id = ${nodeId}::uuid
       WHERE path <@ (SELECT path FROM nodes WHERE id = ${nodeId}::uuid)
         AND deleted_at IS NULL`;
    await this.audit.log({
      actorId: user.id,
      action: 'node.trash',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, itemCount: count },
      ctx,
    });
  }

  assertCanDelete(user: AuthenticatedUser, node: NodeAccess) {
    if (!roleAtLeast(node.role, 'ADMIN') && node.createdById !== user.id) {
      throw AppError.forbidden('Editors can only delete items they created');
    }
  }

  // ---------------------------------------------------------------- Helpers

  /** Kiểm tra có thể tạo/đưa mục vào `parentId` (null = gốc workspace, chỉ thành viên EDITOR+). */
  private async requireContainer(
    user: AuthenticatedUser,
    workspaceId: string,
    parentId: string | null,
  ) {
    if (!parentId) {
      await this.access.requireMember(user, workspaceId, 'EDITOR');
      return;
    }
    const parent = await this.access.requireNode(user, parentId, 'EDITOR');
    if (parent.workspaceId !== workspaceId) {
      throw AppError.validation('Target folder belongs to another workspace');
    }
    if (parent.type !== 'FOLDER') throw AppError.validation('Target must be a folder');
  }

  /** Trùng tên → 409 kèm gợi ý tên còn trống trong folder đích. */
  async mapNameConflict(
    err: unknown,
    workspaceId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<unknown> {
    if (!isNameConflict(err)) return err;
    const taken = await this.siblingKeys(workspaceId, parentId, excludeId);
    return AppError.conflict('An item with this name already exists in this folder', {
      suggestion: suggestName(name, taken),
    });
  }

  async siblingKeys(
    workspaceId: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<Set<string>> {
    const where: Prisma.NodeWhereInput = {
      workspaceId,
      parentId,
      deletedAt: null,
      id: excludeId ? { not: excludeId } : undefined,
    };
    const siblings = await this.prisma.client.node.findMany({
      where,
      select: { nameNormalized: true },
    });
    return new Set(siblings.map((s) => s.nameNormalized));
  }
}
