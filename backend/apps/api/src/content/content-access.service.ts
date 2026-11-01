import {
  accessColumns,
  type ContentRole,
  contentRoleAtLeast,
  effectiveRole,
  Prisma,
  type NodeSection,
  type NodeType,
  type WorkspaceRole,
} from '@luna/db';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

export type { ContentRole };

export const AS_DOCUMENT = { types: ['DOCUMENT'], notFound: 'Document not found' } as const;
export const AS_VIDEO = { types: ['VIDEO'], notFound: 'Video not found' } as const;
export const AS_FILE = { types: ['FILE', 'VIDEO'], notFound: 'File not found' } as const;
export const AS_FILE_ONLY = { types: ['FILE'], notFound: 'File not found' } as const;

export const MEMBER_RANK: Record<WorkspaceRole, number> = { VIEWER: 1, MEMBER: 2, ADMIN: 3 };

export interface NodeAccess {
  id: string;
  workspaceId: string;
  parentId: string | null;
  type: NodeType;
  section: NodeSection;
  name: string;
  createdById: string;
  deletedAt: Date | null;
  deletedRootId: string | null;
  deletedById: string | null;
  isMember: boolean;
  memberRole: WorkspaceRole | null;
  role: ContentRole | null;
}

interface AccessRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  type: NodeType;
  section: NodeSection;
  name: string;
  created_by: string;
  deleted_at: Date | null;
  deleted_root_id: string | null;
  deleted_by: string | null;
  member_role: string | null;
  share_role: string | null;
}

@Injectable()
export class ContentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveMany(userId: string, nodeIds: string[]): Promise<Map<string, NodeAccess>> {
    if (nodeIds.length === 0) return new Map();
    const rows = await this.prisma.client.$queryRaw<AccessRow[]>`
      SELECT n.id, n.workspace_id, n.parent_id, n.type, n.section, n.name, n.created_by,
             n.deleted_at, n.deleted_root_id, n.deleted_by, ${accessColumns(userId)}
        FROM nodes n
        JOIN workspaces w ON w.id = n.workspace_id AND w.deleted_at IS NULL
       WHERE n.id = ANY(${nodeIds}::uuid[])`;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          workspaceId: r.workspace_id,
          parentId: r.parent_id,
          type: r.type,
          section: r.section,
          name: r.name,
          createdById: r.created_by,
          deletedAt: r.deleted_at,
          deletedRootId: r.deleted_root_id,
          deletedById: r.deleted_by,
          isMember: !!r.member_role,
          memberRole: (r.member_role as WorkspaceRole | null) ?? null,
          role: effectiveRole(r),
        },
      ]),
    );
  }

  async requireNode(
    user: Pick<AuthenticatedUser, 'id'>,
    nodeId: string,
    min: ContentRole,
    opts: { allowDeleted?: boolean; types?: readonly NodeType[]; notFound?: string } = {},
  ): Promise<NodeAccess & { role: ContentRole }> {
    const { allowDeleted = false, types, notFound = 'Item not found' } = opts;
    const access = (await this.resolveMany(user.id, [nodeId])).get(nodeId);
    if (!access || !access.role || (access.deletedAt && !allowDeleted)) {
      throw AppError.notFound('Item not found');
    }
    if (!contentRoleAtLeast(access.role, min)) {
      throw AppError.forbidden(
        min === 'OWNER'
          ? 'Only the owner or someone with edit sharing can do this'
          : 'You only have view access to this item',
      );
    }
    if (types && !types.includes(access.type)) throw AppError.notFound(notFound);
    return access as NodeAccess & { role: ContentRole };
  }

  async requireMember(
    user: AuthenticatedUser,
    workspaceId: string,
    min: WorkspaceRole = 'VIEWER',
  ): Promise<WorkspaceRole> {
    const member = await this.prisma.client.workspaceMember.findFirst({
      where: { workspaceId, userId: user.id, workspace: { deletedAt: null } },
      select: { role: true },
    });
    if (!member) throw AppError.notFound('Workspace not found');
    if (MEMBER_RANK[member.role] < MEMBER_RANK[min]) {
      throw AppError.forbidden(
        min === 'ADMIN'
          ? 'Only workspace admins can do this'
          : 'You only have view access in this workspace',
      );
    }
    return member.role;
  }

  visibleTo(userId: string): Prisma.Sql {
    return Prisma.sql`(
      EXISTS (SELECT 1 FROM workspace_members m
               WHERE m.workspace_id = n.workspace_id AND m.user_id = ${userId}::uuid)
      OR EXISTS (SELECT 1 FROM node_shares s JOIN nodes a ON a.id = s.node_id
                  WHERE s.user_id = ${userId}::uuid AND a.path @> n.path)
    )`;
  }
}
