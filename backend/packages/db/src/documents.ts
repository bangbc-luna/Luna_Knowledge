import { diffWords } from 'diff';
import { accessColumns, type ContentRole, effectiveRole } from './access.js';
import type { Prisma, PrismaClient } from './generated/prisma/client.js';

export interface DocumentAccess {
  nodeId: string;
  workspaceId: string;
  type: string;
  createdById: string;
  role: ContentRole;
}

export async function resolveDocumentAccess(
  prisma: PrismaClient,
  userId: string,
  nodeId: string,
): Promise<DocumentAccess | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      workspace_id: string;
      type: string;
      created_by: string;
      member_role: string | null;
      share_role: string | null;
    }>
  >`
    SELECT n.id, n.workspace_id, n.type::text AS type, n.created_by, ${accessColumns(userId)}
      FROM nodes n
      JOIN workspaces w ON w.id = n.workspace_id AND w.deleted_at IS NULL
      JOIN users u ON u.id = ${userId}::uuid AND u.status = 'ACTIVE'
     WHERE n.id = ${nodeId}::uuid AND n.deleted_at IS NULL`;
  const r = rows[0];
  if (!r) return null;
  const role = effectiveRole(r);
  return role
    ? { nodeId: r.id, workspaceId: r.workspace_id, type: r.type, createdById: r.created_by, role }
    : null;
}

export function wordDiffStats(before: string, after: string) {
  let added = 0;
  let removed = 0;
  const count = (t: string) => (t.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  for (const part of diffWords(before, after)) {
    if (part.added) added += count(part.value);
    else if (part.removed) removed += count(part.value);
  }
  return { added, removed };
}

export interface NewDocumentVersion {
  nodeId: string;
  yjsSnapshot: Uint8Array;
  contentJson: Prisma.InputJsonValue;
  contentText: string;
  wordCount: number;
  name?: string | null;
  isAuto?: boolean;
  createdById?: string | null;
  restoredFromId?: string | null;
}

export async function createDocumentVersion(prisma: PrismaClient, v: NewDocumentVersion) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT node_id FROM documents WHERE node_id = ${v.nodeId}::uuid FOR UPDATE`;
    const last = await tx.documentVersion.findFirst({
      where: { nodeId: v.nodeId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true, contentText: true },
    });
    const stats = wordDiffStats(last?.contentText ?? '', v.contentText);
    const created = await tx.documentVersion.create({
      data: {
        nodeId: v.nodeId,
        versionNo: (last?.versionNo ?? 0) + 1,
        name: v.name ?? null,
        isAuto: v.isAuto ?? false,
        restoredFromId: v.restoredFromId ?? null,
        yjsSnapshot: new Uint8Array(v.yjsSnapshot),
        contentJson: v.contentJson,
        contentText: v.contentText,
        wordCount: v.wordCount,
        wordsAdded: stats.added,
        wordsRemoved: stats.removed,
        createdById: v.createdById ?? null,
      },
    });
    await tx.document.update({
      where: { nodeId: v.nodeId },
      data: { dirtySinceVersion: false, lastVersionAt: created.createdAt },
    });
    return created;
  });
}
