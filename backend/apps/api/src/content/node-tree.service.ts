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
import { ContentAccessService } from './content-access.service.js';
import { nameKey, suggestName } from './node-names.js';

const TREE_LOCK_WAIT_MS = 5_000;
const TREE_TX_MAX_WAIT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

export type NodeExtra = {
  description?: string | null;
  status?: NodeStatus;
  document?: Prisma.DocumentCreateWithoutNodeInput;
};

export interface NewNode {
  workspaceId: string;
  parentId: string | null;
  section?: NodeSection;
  type: NodeType;
  name: string;
  autoRename?: boolean;
  extra?: NodeExtra | (() => Promise<NodeExtra>);
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    user: AuthenticatedUser,
    input: NewNode,
    ctx: RequestContext,
    opts: { fill?: (node: CreatedNode) => Promise<void>; announce?: Announce } = {},
  ): Promise<CreatedNode> {
    const { workspaceId, parentId, type } = input;
    const section = await this.requireContainer(user, workspaceId, parentId, input.section);
    const extra = typeof input.extra === 'function' ? await input.extra() : (input.extra ?? {});
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
        await opts.fill(node);
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

  async siblingKeys(
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
