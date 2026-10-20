import type { WorkspaceRole } from '@luna/db';

const RANK: Record<WorkspaceRole, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 };

export function roleAtLeast(role: WorkspaceRole | null, min: WorkspaceRole): boolean {
  return role !== null && RANK[role] >= RANK[min];
}
