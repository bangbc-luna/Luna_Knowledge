import { type AuditAction, Prisma } from '@luna/db';
import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { decodeKeysetCursor, encodeKeysetCursor, type Page } from '../common/pagination/cursor.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { ContentAccessService } from './content-access.service.js';
import type { CreateTagBody, RecentlyUpdatedQuery, UpdateTagBody } from './library.schemas.js';
import { NodeDtoService } from './node-dto.service.js';
import type { NodeDto } from './nodes.schemas.js';

const tagSelect = { id: true, name: true, color: true, createdAt: true } as const;
const RECENT_LIMIT = 50;

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly dto: NodeDtoService,
    private readonly audit: AuditService,
    private readonly search: SearchQueueService,
  ) {}

  async listTags(user: AuthenticatedUser, workspaceId: string) {
    await this.access.requireMember(user, workspaceId);
    return this.prisma.client.tag.findMany({
      where: { workspaceId },
      select: tagSelect,
      orderBy: { name: 'asc' },
    });
  }

  async createTag(
    user: AuthenticatedUser,
    workspaceId: string,
    body: CreateTagBody,
    ctx: RequestContext,
  ) {
    await this.access.requireMember(user, workspaceId, 'MEMBER');
    const tag = await this.withTagConflict(() =>
      this.prisma.client.tag.create({ data: { workspaceId, ...body }, select: tagSelect }),
    );
    await this.auditTag(user, 'tag.create', workspaceId, tag.id, body, ctx);
    return tag;
  }

  async updateTag(
    user: AuthenticatedUser,
    tagId: string,
    body: UpdateTagBody,
    ctx: RequestContext,
  ) {
    const tag = await this.requireTag(user, tagId);
    const updated = await this.withTagConflict(() =>
      this.prisma.client.tag.update({ where: { id: tagId }, data: body, select: tagSelect }),
    );
    await this.auditTag(user, 'tag.update', tag.workspaceId, tagId, body, ctx);
    await this.reindexTagged(tagId);
    return updated;
  }

  async deleteTag(user: AuthenticatedUser, tagId: string, ctx: RequestContext) {
    const tag = await this.requireTag(user, tagId);
    const tagged = await this.prisma.client.nodeTag.findMany({
      where: { tagId },
      select: { nodeId: true },
    });
    await this.prisma.client.tag.delete({ where: { id: tagId } });
    await this.search.node(...tagged.map((t) => t.nodeId));
    await this.auditTag(user, 'tag.delete', tag.workspaceId, tagId, { name: tag.name }, ctx);
  }

  async setNodeTags(user: AuthenticatedUser, nodeId: string, tagIds: string[]) {
    const node = await this.access.requireNode(user, nodeId, 'EDITOR');
    const unique = [...new Set(tagIds)];
    const valid = await this.prisma.client.tag.count({
      where: { id: { in: unique }, workspaceId: node.workspaceId },
    });
    if (valid !== unique.length)
      throw AppError.validation('Some tags do not belong to this workspace');
    await this.prisma.client.$transaction([
      this.prisma.client.nodeTag.deleteMany({ where: { nodeId } }),
      this.prisma.client.nodeTag.createMany({ data: unique.map((tagId) => ({ nodeId, tagId })) }),
    ]);
    await this.search.node(nodeId);
    return this.dto.one(user.id, nodeId);
  }

  async addFavorite(user: AuthenticatedUser, nodeId: string) {
    await this.access.requireNode(user, nodeId, 'VIEWER');
    await this.prisma.client.favorite.upsert({
      where: { userId_nodeId: { userId: user.id, nodeId } },
      create: { userId: user.id, nodeId },
      update: {},
    });
  }

  async removeFavorite(user: AuthenticatedUser, nodeId: string) {
    await this.prisma.client.favorite.deleteMany({ where: { userId: user.id, nodeId } });
  }

  async favorites(user: AuthenticatedUser) {
    const rows = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT n.id FROM favorites f
        JOIN nodes n ON n.id = f.node_id
        JOIN workspaces w ON w.id = n.workspace_id AND w.deleted_at IS NULL
       WHERE f.user_id = ${user.id}::uuid AND n.deleted_at IS NULL AND ${this.access.visibleTo(user.id)}
       ORDER BY f.created_at DESC`;
    return this.dto.build(
      user.id,
      rows.map((r) => r.id),
    );
  }

  async recent(user: AuthenticatedUser) {
    const rows = await this.prisma.client.$queryRaw<{ id: string; viewed_at: Date }[]>`
      SELECT n.id, r.viewed_at FROM recent_views r
        JOIN nodes n ON n.id = r.node_id
        JOIN workspaces w ON w.id = n.workspace_id AND w.deleted_at IS NULL
       WHERE r.user_id = ${user.id}::uuid AND n.deleted_at IS NULL AND ${this.access.visibleTo(user.id)}
       ORDER BY r.viewed_at DESC
       LIMIT ${RECENT_LIMIT}`;
    const dtos = new Map(
      (
        await this.dto.build(
          user.id,
          rows.map((r) => r.id),
        )
      ).map((d) => [d.id, d]),
    );
    return rows.flatMap((r) => {
      const node = dtos.get(r.id);
      return node ? [{ node, viewedAt: r.viewed_at }] : [];
    });
  }

  async recentlyUpdated(
    user: AuthenticatedUser,
    workspaceId: string,
    q: RecentlyUpdatedQuery,
  ): Promise<Page<NodeDto>> {
    const cursor = q.cursor ? decodeKeysetCursor(q.cursor) : null;
    const [allowed] = await this.prisma.client.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM workspaces w
       WHERE w.id = ${workspaceId}::uuid AND w.deleted_at IS NULL
         AND (
           EXISTS (SELECT 1 FROM workspace_members m
                    WHERE m.workspace_id = w.id AND m.user_id = ${user.id}::uuid)
           OR EXISTS (SELECT 1 FROM node_shares s JOIN nodes a ON a.id = s.node_id
                       WHERE s.user_id = ${user.id}::uuid AND a.workspace_id = w.id
                         AND a.deleted_at IS NULL)
         )`;
    if (!allowed) throw AppError.notFound('Workspace not found');
    const cursorClause = cursor
      ? Prisma.sql`AND (n.updated_at, n.id) < (${cursor.at}, ${cursor.id}::uuid)`
      : Prisma.empty;
    const rows = await this.prisma.client.$queryRaw<{ id: string; updated_at: Date }[]>`
      SELECT n.id, n.updated_at FROM nodes n
       WHERE n.workspace_id = ${workspaceId}::uuid AND n.section = ${q.section}::"NodeSection"
         AND n.type <> 'FOLDER' AND n.deleted_at IS NULL AND n.status <> 'UPLOADING'
         AND ${this.access.visibleTo(user.id)}
         ${cursorClause}
       ORDER BY n.updated_at DESC, n.id DESC
       LIMIT ${q.limit + 1}`;
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await this.dto.build(
        user.id,
        page.map((r) => r.id),
      ),
      nextCursor: hasMore && last ? encodeKeysetCursor(last.updated_at, last.id) : null,
    };
  }

  private async reindexTagged(tagId: string) {
    const tagged = await this.prisma.client.nodeTag.findMany({
      where: { tagId },
      select: { nodeId: true },
    });
    await this.search.node(...tagged.map((t) => t.nodeId));
  }

  private async requireTag(user: AuthenticatedUser, tagId: string) {
    const tag = await this.prisma.client.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw AppError.notFound('Tag not found');
    if (!user.isSystemAdmin) await this.access.requireMember(user, tag.workspaceId, 'ADMIN');
    return tag;
  }

  private async withTagConflict<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict('A tag with this name already exists in this workspace');
      }
      throw err;
    }
  }

  private auditTag(
    user: AuthenticatedUser,
    action: AuditAction,
    workspaceId: string,
    tagId: string,
    metadata: Prisma.InputJsonObject,
    ctx: RequestContext,
  ) {
    return this.audit.log({
      actorId: user.id,
      action,
      targetType: 'tag',
      targetId: tagId,
      workspaceId,
      metadata,
      ctx,
    });
  }
}
