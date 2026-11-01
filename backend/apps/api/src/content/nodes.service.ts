import {
  type AuditAction,
  lockWorkspaceTree,
  type NodeSection,
  type NodeType,
  type Prisma,
} from '@luna/db';
import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import type { Page } from '../common/pagination/cursor.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CollabEventsService } from '../infra/redis/collab-events.service.js';
import { isNameConflict, isTreeBusy, isTreeViolation } from './conflicts.js';
import { ContentAccessService } from './content-access.service.js';
import { NodeDtoService } from './node-dto.service.js';
import { nameKey, suggestName } from './node-names.js';
import type { CreateFolderBody, ListNodesQuery, NodeDto } from './nodes.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;

const ACTIVITY_ACTIONS: readonly AuditAction[] = [
  'node.create',
  'node.rename',
  'node.move',
  'node.trash',
  'node.restore',
  'document.edit',
  'document.import',
  'document.copy',
  'document.version_create',
  'document.version_restore',
  'file.upload',
  'file.version_restore',
  'file.regenerate',
  'video.retranscode',
  'video.update_info',
  'share.add',
  'share.update',
  'share.remove',
];

const TREE_LOCK_WAIT_MS = 5_000;
const TREE_TX_MAX_WAIT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

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
    private readonly search: SearchQueueService,
    private readonly collab: CollabEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

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
      await this.access.requireMember(user, workspaceId);
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
        ...(q.parentId ? {} : { section: q.section }),
        deletedAt: null,
        type: q.type,
        OR: [{ status: { not: 'UPLOADING' } }, { createdById: user.id }],
      },
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
    const start = node.isMember
      ? 0
      : Math.max(
          0,
          rows.findIndex((r) => r.shared),
        );
    return rows.slice(start).map(({ id, name, type }) => ({ id, name, type }));
  }

  async activity(user: AuthenticatedUser, nodeId: string, q: { cursor?: string; limit: number }) {
    const node = (await this.access.resolveMany(user.id, [nodeId])).get(nodeId);
    if (!node || (!node.role && !user.isSystemAdmin)) throw AppError.notFound('Item not found');
    if (node.role !== 'OWNER' && !user.isSystemAdmin) {
      throw AppError.forbidden(
        'Only the owner or someone with edit sharing can see the activity log',
      );
    }
    const rows = await this.prisma.client.auditLog.findMany({
      where: {
        targetId: nodeId,
        action: { in: [...ACTIVITY_ACTIONS] },
        ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((id): id is string => !!id))];
    const actors = await this.prisma.client.user.findMany({
      where: { id: { in: actorIds } },
      select: userSummary,
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return {
      items: page.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        actor: r.actorId ? (byId.get(r.actorId) ?? null) : null,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt,
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id.toString() : null,
    };
  }

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

  async createFolder(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateFolderBody,
    ctx: RequestContext,
  ): Promise<NodeDto> {
    const parentId = body.parentId ?? null;
    const section = await this.requireContainer(user, workspaceId, parentId, body.section);
    try {
      const node = await this.withTreeLock(workspaceId, (tx) =>
        tx.node.create({
          data: {
            workspaceId,
            parentId,
            section,
            type: 'FOLDER',
            name: body.name,
            nameNormalized: nameKey(body.name),
            createdById: user.id,
            updatedById: user.id,
          },
        }),
      );
      await this.audit.log({
        actorId: user.id,
        action: 'node.create',
        targetType: 'node',
        targetId: node.id,
        workspaceId,
        metadata: { type: 'FOLDER', name: body.name, parentId },
        ctx,
      });
      await this.search.node(node.id);
      return this.dto.one(user.id, node.id);
    } catch (err) {
      throw await this.mapNameConflict(err, workspaceId, parentId, body.name, undefined, section);
    }
  }

  rename(user: AuthenticatedUser, nodeId: string, name: string, ctx: RequestContext) {
    return this.updateDetails(user, nodeId, { name }, ctx);
  }

  async updateDetails(
    user: AuthenticatedUser,
    nodeId: string,
    details: { name: string; description?: string },
    ctx: RequestContext,
    type?: NodeType,
  ): Promise<NodeDto> {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR');
    if (type && node.type !== type) throw AppError.notFound('Item not found');
    const { name, description } = details;
    const before =
      description === undefined
        ? null
        : await this.prisma.client.node.findUniqueOrThrow({
            where: { id: nodeId },
            select: { description: true },
          });
    try {
      await this.prisma.client.node.update({
        where: { id: nodeId },
        data: { name, nameNormalized: nameKey(name), description, updatedById: user.id },
      });
    } catch (err) {
      throw await this.mapNameConflict(
        err,
        node.workspaceId,
        node.parentId,
        name,
        nodeId,
        node.section,
      );
    }
    await this.audit.log({
      actorId: user.id,
      action: before ? 'video.update_info' : 'node.rename',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: before
        ? { from: node.name, to: name, descriptionChanged: before.description !== description }
        : { from: node.name, to: name },
      ctx,
    });
    await this.search.node(nodeId);
    return this.dto.one(user.id, nodeId);
  }

  async move(
    user: AuthenticatedUser,
    nodeId: string,
    targetParentId: string | null,
    ctx: RequestContext,
  ): Promise<NodeDto> {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR');
    if (targetParentId === node.id) throw AppError.validation('Cannot move an item into itself');
    await this.requireContainer(user, node.workspaceId, targetParentId, node.section);
    if (targetParentId === node.parentId) return this.dto.one(user.id, nodeId);

    try {
      await this.withTreeLock(node.workspaceId, async (tx) => {
        const [current] = await tx.$queryRaw<{ deleted_at: Date | null }[]>`
          SELECT deleted_at FROM nodes WHERE id = ${nodeId}::uuid FOR UPDATE`;
        if (!current || current.deleted_at) {
          throw AppError.conflict('This item was just moved or deleted, refresh and try again');
        }
        if (targetParentId) {
          const [target] = await tx.$queryRaw<{ inside: boolean }[]>`
            SELECT (t.path <@ n.path) AS inside
              FROM nodes t, nodes n
             WHERE t.id = ${targetParentId}::uuid AND n.id = ${nodeId}::uuid`;
          if (target?.inside)
            throw AppError.validation('Cannot move a folder into its own subfolder');
        }
        await tx.node.update({
          where: { id: nodeId },
          data: { parentId: targetParentId, updatedById: user.id },
        });
      });
    } catch (err) {
      throw await this.mapNameConflict(
        err,
        node.workspaceId,
        targetParentId,
        node.name,
        nodeId,
        node.section,
      );
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
    await this.search.tree(nodeId);
    await this.collab.accessChanged({ workspaceId: node.workspaceId });
    return this.dto.one(user.id, nodeId);
  }

  async trash(user: AuthenticatedUser, nodeId: string, ctx: RequestContext): Promise<void> {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR');
    const count = await this.withTreeLock(
      node.workspaceId,
      (tx) => tx.$executeRaw`
        UPDATE nodes
           SET deleted_at = now(), deleted_by = ${user.id}::uuid, deleted_root_id = ${nodeId}::uuid
         WHERE path <@ (SELECT path FROM nodes WHERE id = ${nodeId}::uuid)
           AND deleted_at IS NULL`,
    );
    await this.audit.log({
      actorId: user.id,
      action: 'node.trash',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, itemCount: count },
      ctx,
    });
    await this.search.tree(nodeId);
    await this.collab.accessChanged({ workspaceId: node.workspaceId });
  }

  async withTreeLock<T>(
    workspaceId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.client.$transaction(
        async (tx) => {
          await lockWorkspaceTree(tx, workspaceId, { lockTimeoutMs: TREE_LOCK_WAIT_MS });
          return fn(tx);
        },
        {
          maxWait: TREE_TX_MAX_WAIT_MS,
          timeout: this.config.DB_STATEMENT_TIMEOUT_MS ?? DEFAULT_STATEMENT_TIMEOUT_MS,
        },
      );
    } catch (err) {
      if (isTreeBusy(err)) {
        throw AppError.unavailable(
          'Someone else is changing this workspace right now, try again in a moment',
        );
      }
      throw err;
    }
  }

  async requireContainer(
    user: AuthenticatedUser,
    workspaceId: string,
    parentId: string | null,
    section?: NodeSection,
  ): Promise<NodeSection> {
    if (!parentId) {
      await this.access.requireMember(user, workspaceId, 'MEMBER');
      return section ?? 'DOCS';
    }
    const parent = await this.access.requireNode(user, parentId, 'EDITOR');
    if (parent.workspaceId !== workspaceId) {
      throw AppError.validation('Target folder belongs to another workspace');
    }
    if (parent.type !== 'FOLDER') throw AppError.validation('Target must be a folder');
    if (section && parent.section !== section) {
      throw AppError.validation(
        section === 'VIDEOS'
          ? 'Videos live in the Video area, pick a folder there'
          : 'This folder is in the Video area, which only holds videos',
      );
    }
    return parent.section;
  }

  async mapNameConflict(
    err: unknown,
    workspaceId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
    section: NodeSection = 'DOCS',
  ): Promise<unknown> {
    if (isTreeViolation(err)) {
      return AppError.conflict(
        'The target folder was just moved or deleted, refresh and try again',
      );
    }
    if (!isNameConflict(err)) return err;
    const taken = await this.siblingKeys(workspaceId, parentId, excludeId, section);
    return AppError.conflict('An item with this name already exists in this folder', {
      suggestion: suggestName(name, taken),
    });
  }

  async siblingKeys(
    workspaceId: string,
    parentId: string | null,
    excludeId?: string,
    section: NodeSection = 'DOCS',
    db: Prisma.TransactionClient = this.prisma.client,
  ): Promise<Set<string>> {
    const where: Prisma.NodeWhereInput = {
      workspaceId,
      parentId,
      ...(parentId ? {} : { section }),
      deletedAt: null,
      id: excludeId ? { not: excludeId } : undefined,
    };
    const siblings = await db.node.findMany({
      where,
      select: { nameNormalized: true },
    });
    return new Set(siblings.map((s) => s.nameNormalized));
  }
}
