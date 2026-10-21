import { Prisma } from './generated/prisma/client.js';

export type ContentRole = 'VIEWER' | 'EDITOR' | 'OWNER';

const RANK: Record<ContentRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export function contentRoleAtLeast(role: ContentRole | null | undefined, min: ContentRole): boolean {
  return !!role && RANK[role] >= RANK[min];
}

export function accessColumns(userId: string): Prisma.Sql {
  return Prisma.sql`
    (SELECT m.role::text FROM workspace_members m
      WHERE m.workspace_id = n.workspace_id AND m.user_id = ${userId}::uuid) AS member_role,
    (SELECT s.role::text FROM node_shares s JOIN nodes a ON a.id = s.node_id
      WHERE s.user_id = ${userId}::uuid AND a.path @> n.path
      ORDER BY s.role ASC LIMIT 1) AS share_role,
    EXISTS (SELECT 1 FROM nodes o
             WHERE o.workspace_id = n.workspace_id AND o.path @> n.path AND o.created_by = ${userId}::uuid) AS owns`;
}

export function effectiveRole(r: { member_role: string | null; share_role: string | null; owns: boolean }): ContentRole | null {
  const shared: ContentRole | null = r.share_role === 'EDITOR' ? 'OWNER' : r.share_role === 'VIEWER' ? 'VIEWER' : null;
  const base: ContentRole | null = r.member_role ? 'EDITOR' : null;
  let role = !base ? shared : !shared ? base : RANK[base] >= RANK[shared] ? base : shared;
  if (role && r.owns) role = 'OWNER';
  return role;
}
