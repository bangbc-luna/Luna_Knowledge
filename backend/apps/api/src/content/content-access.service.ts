import { Prisma, type NodeType, type WorkspaceRole } from '@luna/db';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { roleAtLeast } from '../workspaces/workspace-roles.js';

/** Quyền trên nội dung: cùng thang với vai trò workspace (share chỉ cấp EDITOR/VIEWER). */
export type ContentRole = WorkspaceRole;

export interface NodeAccess {
  id: string;
  workspaceId: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  createdById: string;
  deletedAt: Date | null;
  deletedRootId: string | null;
  deletedById: string | null;
  /** Vai trò thành viên workspace; null nếu chỉ truy cập qua share. */
  memberRole: WorkspaceRole | null;
  /** Quyền thực tế = max(vai trò workspace, share trên node hoặc tổ tiên). */
  role: ContentRole | null;
}

interface AccessRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  type: NodeType;
  name: string;
  created_by: string;
  deleted_at: Date | null;
  deleted_root_id: string | null;
  deleted_by: string | null;
  member_role: WorkspaceRole | null;
  share_role: 'EDITOR' | 'VIEWER' | null;
}

const RANK: Record<ContentRole, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 };

function maxRole(a: ContentRole | null, b: ContentRole | null): ContentRole | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Permission engine (SPEC §3.3, §6). System Admin KHÔNG tự có quyền xem nội dung:
 * muốn xem phải là thành viên workspace (quyết định 2026-10-14).
 */
@Injectable()
export class ContentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tính quyền cho nhiều node trong một truy vấn (dùng GiST index trên `path`). */
  async resolveMany(userId: string, nodeIds: string[]): Promise<Map<string, NodeAccess>> {
    if (nodeIds.length === 0) return new Map();
    const rows = await this.prisma.client.$queryRaw<AccessRow[]>`
      SELECT n.id, n.workspace_id, n.parent_id, n.type, n.name, n.created_by,
             n.deleted_at, n.deleted_root_id, n.deleted_by,
             m.role AS member_role,
             (SELECT s.role FROM node_shares s
                JOIN nodes a ON a.id = s.node_id
               WHERE s.user_id = ${userId}::uuid AND a.path @> n.path
               ORDER BY s.role ASC
               LIMIT 1) AS share_role
        FROM nodes n
        JOIN workspaces w ON w.id = n.workspace_id AND w.deleted_at IS NULL
        LEFT JOIN workspace_members m ON m.workspace_id = n.workspace_id AND m.user_id = ${userId}::uuid
       WHERE n.id = ANY(${nodeIds}::uuid[])`;
    // ShareRole enum khai báo EDITOR trước VIEWER nên ORDER BY ASC lấy quyền cao nhất.
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          workspaceId: r.workspace_id,
          parentId: r.parent_id,
          type: r.type,
          name: r.name,
          createdById: r.created_by,
          deletedAt: r.deleted_at,
          deletedRootId: r.deleted_root_id,
          deletedById: r.deleted_by,
          memberRole: r.member_role,
          role: maxRole(r.member_role, r.share_role),
        },
      ]),
    );
  }

  /**
   * Lấy node và kiểm tra quyền. Không có quyền xem → 404 (không lộ sự tồn tại);
   * xem được nhưng thiếu quyền → 403. Node trong thùng rác → 404 trừ khi `allowDeleted`.
   */
  async requireNode(
    user: AuthenticatedUser,
    nodeId: string,
    min: ContentRole,
    { allowDeleted = false } = {},
  ): Promise<NodeAccess & { role: ContentRole }> {
    const access = (await this.resolveMany(user.id, [nodeId])).get(nodeId);
    if (!access || !access.role || (access.deletedAt && !allowDeleted)) {
      throw AppError.notFound('Item not found');
    }
    if (!roleAtLeast(access.role, min)) {
      throw AppError.forbidden(`Requires ${min} permission on this item`);
    }
    return access as NodeAccess & { role: ContentRole };
  }

  /** Thao tác ở cấp workspace (gốc cây, thùng rác, tag): chỉ thành viên. */
  async requireMember(
    user: AuthenticatedUser,
    workspaceId: string,
    min: ContentRole,
  ): Promise<WorkspaceRole> {
    const member = await this.prisma.client.workspaceMember.findFirst({
      where: { workspaceId, userId: user.id, workspace: { deletedAt: null } },
      select: { role: true },
    });
    if (!member) throw AppError.notFound('Workspace not found');
    if (!roleAtLeast(member.role, min)) {
      throw AppError.forbidden(`Requires ${min} role in this workspace`);
    }
    return member.role;
  }

  /** Điều kiện SQL "user xem được node `n`" cho các danh sách gom từ nhiều workspace. */
  visibleTo(userId: string): Prisma.Sql {
    return Prisma.sql`(
      EXISTS (SELECT 1 FROM workspace_members m
               WHERE m.workspace_id = n.workspace_id AND m.user_id = ${userId}::uuid)
      OR EXISTS (SELECT 1 FROM node_shares s JOIN nodes a ON a.id = s.node_id
                  WHERE s.user_id = ${userId}::uuid AND a.path @> n.path)
    )`;
  }
}
