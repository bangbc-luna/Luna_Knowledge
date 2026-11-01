import {
  type AuditAction,
  lockWorkspaceTree,
  type NodeSection,
  type NodeStatus,
  type NodeType,
  type Prisma,
} from '@luna/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import { isNameConflict, isTreeBusy, isTreeViolation } from './conflicts.js';
import { CollabEventsService } from '../infra/redis/collab-events.service.js';
import { ContentAccessService, type NodeAccess } from './content-access.service.js';
import { nameKey, suggestName } from './node-names.js';

const TREE_LOCK_WAIT_MS = 5_000;
const TREE_TX_MAX_WAIT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

export type NodeExtra = {
  description?: string | null;
  status?: NodeStatus;
  document?: Prisma.DocumentCreateWithoutNodeInput;
};

export interface PreparedExtra<C> {
  fields: NodeExtra;
  context: C;
}

export interface NewNode<C = undefined> {
  workspaceId: string;
  parentId: string | null;
  section?: NodeSection;
  type: NodeType;
  name: string;
  autoRename?: boolean;
  extra?: NodeExtra | (() => Promise<PreparedExtra<C>>);
}

export interface CreatedNode {
  id: string;
  workspaceId: string;
  parentId: string | null;
  section: NodeSection;
  type: NodeType;
  name: string;
}

export type Announce =
  false | { action: AuditAction; metadata: (node: CreatedNode) => Prisma.InputJsonObject };

export interface NameScope {
  workspaceId: string;
  parentId: string | null;
  section: NodeSection;
  name: string;
  excludeId?: string;
}

const DEFAULT_ANNOUNCE: Announce = {
  action: 'node.create',
  metadata: (n) => ({ type: n.type, name: n.name, parentId: n.parentId }),
};

const CREATED_NODE_SELECT = {
  id: true,
  workspaceId: true,
  parentId: true,
  section: true,
  type: true,
  name: true,
} as const;

@Injectable()
export class NodeTree {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly audit: AuditService,
    private readonly search: SearchQueueService,
    private readonly collab: CollabEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create<C = undefined>(
    user: AuthenticatedUser,
    input: NewNode<C>,
    ctx: RequestContext,
    opts: { fill?: (node: CreatedNode, context: C) => Promise<void>; announce?: Announce } = {},
  ): Promise<CreatedNode> {
    const { workspaceId, parentId, type } = input;
    const section = await this.requireContainer(user, workspaceId, parentId, input.section);
    const { fields: extra, context } =
      typeof input.extra === 'function'
        ? await input.extra()
        : { fields: input.extra ?? {}, context: undefined as C };
    let name = input.name;
    let node: CreatedNode;
    try {
      node = await this.withLock(workspaceId, async (tx) => {
        if (input.autoRename) {
          const taken = await this.siblingKeys({ workspaceId, parentId, section }, tx);
          if (taken.has(nameKey(name))) name = suggestName(name, taken);
        }
        return tx.node.create({
          data: {
            workspaceId,
            parentId,
            section,
            type,
            name,
            nameNormalized: nameKey(name),
            description: extra.description,
            status: extra.status,
            document: extra.document ? { create: extra.document } : undefined,
            createdById: user.id,
            updatedById: user.id,
          },
          select: CREATED_NODE_SELECT,
        });
      });
    } catch (err) {
      throw await this.mapConflict(err, { workspaceId, parentId, section, name });
    }

    if (opts.fill) {
      try {
        await opts.fill(node, context);
      } catch (err) {
        await this.prisma.client.node.delete({ where: { id: node.id } }).catch(() => undefined);
        throw err;
      }
    }

    const announce = opts.announce ?? DEFAULT_ANNOUNCE;
    if (announce !== false) {
      await this.audit.log({
        actorId: user.id,
        action: announce.action,
        targetType: 'node',
        targetId: node.id,
        workspaceId,
        metadata: announce.metadata(node),
        ctx,
      });
      await this.search.node(node.id);
    }
    return node;
  }

  async move(
    user: AuthenticatedUser,
    nodeId: string,
    targetParentId: string | null,
    ctx: RequestContext,
  ): Promise<void> {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR');
    if (targetParentId === node.id) throw AppError.validation('Cannot move an item into itself');
    await this.requireContainer(user, node.workspaceId, targetParentId, node.section);
    if (targetParentId === node.parentId) return;

    try {
      await this.withLock(node.workspaceId, async (tx) => {
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
        await this.placeAt(tx, node, targetParentId, { autoRename: false, userId: user.id });
      });
    } catch (err) {
      throw await this.mapConflict(err, {
        workspaceId: node.workspaceId,
        parentId: targetParentId,
        section: node.section,
        name: node.name,
        excludeId: nodeId,
      });
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
  }

  async restore(
    user: AuthenticatedUser,
    root: NodeAccess,
    ctx: RequestContext,
  ): Promise<{ parentId: string | null; name: string }> {
    const result = await this.withLock(root.workspaceId, async (tx) => {
      const [current] = await tx.$queryRaw<{ deleted_root_id: string | null }[]>`
        SELECT deleted_root_id FROM nodes WHERE id = ${root.id}::uuid FOR UPDATE`;
      if (!current) throw AppError.notFound('Item not found');
      if (current.deleted_root_id !== root.id) {
        throw AppError.validation('Item is not in the trash');
      }
      const [parent] = root.parentId
        ? await tx.$queryRaw<{ deleted_at: Date | null }[]>`
            SELECT deleted_at FROM nodes WHERE id = ${root.parentId}::uuid FOR SHARE`
        : [];
      const parentId = parent && !parent.deleted_at ? root.parentId : null;
      const name = await this.placeAt(tx, root, parentId, { autoRename: true, userId: user.id });
      await tx.node.updateMany({
        where: { deletedRootId: root.id },
        data: { deletedAt: null, deletedById: null, deletedRootId: null },
      });
      return { parentId, name };
    });

    await this.audit.log({
      actorId: user.id,
      action: 'node.restore',
      targetType: 'node',
      targetId: root.id,
      workspaceId: root.workspaceId,
      metadata: {
        restoredTo: result.parentId,
        movedToRoot: result.parentId !== root.parentId,
        renamedTo: result.name !== root.name ? result.name : undefined,
      },
      ctx,
    });
    await this.search.tree(root.id);
    return result;
  }

  async withLock<T>(
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

  async mapConflict(err: unknown, scope: NameScope): Promise<unknown> {
    if (isTreeViolation(err)) {
      return AppError.conflict(
        'The target folder was just moved or deleted, refresh and try again',
      );
    }
    if (!isNameConflict(err)) return err;
    const taken = await this.siblingKeys(scope);
    return AppError.conflict('An item with this name already exists in this folder', {
      suggestion: suggestName(scope.name, taken),
    });
  }

  private async placeAt(
    tx: Prisma.TransactionClient,
    node: { id: string; workspaceId: string; section: NodeSection; name: string },
    parentId: string | null,
    opts: { autoRename: boolean; userId: string },
  ): Promise<string> {
    let name = node.name;
    if (opts.autoRename) {
      const taken = await this.siblingKeys(
        { workspaceId: node.workspaceId, parentId, section: node.section },
        tx,
      );
      if (taken.has(nameKey(name))) name = suggestName(name, taken);
    }
    await tx.node.update({
      where: { id: node.id },
      data: {
        parentId,
        updatedById: opts.userId,
        ...(name !== node.name ? { name, nameNormalized: nameKey(name) } : {}),
      },
    });
    return name;
  }

  private async requireContainer(
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

  private async siblingKeys(
    scope: Omit<NameScope, 'name'>,
    db: Prisma.TransactionClient = this.prisma.client,
  ): Promise<Set<string>> {
    const { workspaceId, parentId, section, excludeId } = scope;
    const siblings = await db.node.findMany({
      where: {
        workspaceId,
        parentId,
        ...(parentId ? {} : { section }),
        deletedAt: null,
        id: excludeId ? { not: excludeId } : undefined,
      },
      select: { nameNormalized: true },
    });
    return new Set(siblings.map((s) => s.nameNormalized));
  }
}
