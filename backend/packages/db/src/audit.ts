import type { Prisma, PrismaClient } from './generated/prisma/client.js';

export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.session_revoked',
  'comment.create',
  'comment.delete',
  'comment.reply',
  'comment.resolve',
  'comment.reopen',
  'document.copy',
  'document.edit',
  'document.export',
  'document.import',
  'document.version_create',
  'document.version_restore',
  'file.download',
  'file.regenerate',
  'file.upload',
  'file.version_restore',
  'node.create',
  'node.delete_permanent',
  'node.move',
  'node.rename',
  'node.restore',
  'node.trash',
  'node.view',
  'share.add',
  'share.remove',
  'share.update',
  'tag.create',
  'tag.delete',
  'tag.update',
  'trash.empty',
  'upload.abort',
  'upload.start',
  'user.update',
  'video.original_access',
  'video.play',
  'video.retranscode',
  'video.update_info',
  'workspace.create',
  'workspace.delete',
  'workspace.member_add',
  'workspace.member_remove',
  'workspace.member_update',
  'workspace.update',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRecord {
  actorId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  workspaceId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(
  db: Pick<PrismaClient, 'auditLog'>,
  record: AuditRecord,
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: record.actorId,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      workspaceId: record.workspaceId,
      metadata: record.metadata,
      ip: record.ip,
      userAgent: record.userAgent,
    },
  });
}
