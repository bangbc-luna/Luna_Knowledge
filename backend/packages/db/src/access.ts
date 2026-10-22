import { Prisma } from './generated/prisma/client.js';

export type ContentRole = 'VIEWER' | 'EDITOR' | 'OWNER';

const RANK: Record<ContentRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

export function contentRoleAtLeast(
  role: ContentRole | null | undefined,
  min: ContentRole,
): boolean {
  return !!role && RANK[role] >= RANK[min];
}

export function accessColumns(userId: string): Prisma.Sql {
  return Prisma.sql`
    (SELECT m.role::text FROM workspace_members m
      WHERE m.workspace_id = n.workspace_id AND m.user_id = ${userId}::uuid) AS member_role,
    (SELECT s.role::text FROM node_shares s JOIN nodes a ON a.id = s.node_id
      WHERE s.user_id = ${userId}::uuid AND a.path @> n.path
      ORDER BY s.role ASC LIMIT 1) AS share_role`;
}

const MEMBER_ROLE: Record<string, ContentRole> = {
  ADMIN: 'OWNER',
  MEMBER: 'EDITOR',
  VIEWER: 'VIEWER',
};
const SHARE_ROLE: Record<string, ContentRole> = { EDITOR: 'OWNER', VIEWER: 'VIEWER' };

export function effectiveRole(r: {
  member_role: string | null;
  share_role: string | null;
}): ContentRole | null {
  const base = r.member_role ? (MEMBER_ROLE[r.member_role] ?? null) : null;
  const shared = r.share_role ? (SHARE_ROLE[r.share_role] ?? null) : null;
  if (!base) return shared;
  if (!shared) return base;
  return RANK[base] >= RANK[shared] ? base : shared;
}
