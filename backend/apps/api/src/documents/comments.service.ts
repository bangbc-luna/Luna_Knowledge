import type { ThreadStatus } from '@luna/db';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { ContentAccessService } from '../content/content-access.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { roleAtLeast } from '../workspaces/workspace-roles.js';
import type { CreateThreadBody, ReplyBody, ThreadsQuery } from './comments.schemas.js';
import { DocumentsService } from './documents.service.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const threadInclude = {
  createdBy: { select: userSummary },
  resolvedBy: { select: userSummary },
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: userSummary } },
  },
};
const SNIPPET = 140;

type UserSummary = { id: string; email: string; name: string; avatarUrl: string | null };

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ContentAccessService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, nodeId: string, q: ThreadsQuery) {
    const node = await this.documents.requireDocument(user, nodeId, 'VIEWER');
    const threads = await this.prisma.client.commentThread.findMany({
      where: { nodeId, ...(q.status === 'ALL' ? {} : { status: q.status as ThreadStatus }) },
      include: threadInclude,
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.mentionedUsers(
      threads.flatMap((t) => t.comments.flatMap((c) => c.mentions)),
    );
    return threads.map((t) => this.threadDto(t, user, node.role, users));
  }

  async createThread(
    user: AuthenticatedUser,
    nodeId: string,
    body: CreateThreadBody,
    ctx: RequestContext,
  ) {
    const node = await this.documents.requireDocument(user, nodeId, 'VIEWER');
    const doc = await this.prisma.client.document.findUnique({
      where: { nodeId },
      select: { format: true },
    });
    if (doc?.format === 'LATEX') {
      throw AppError.validation('Comments are not available on LaTeX documents yet');
    }
    const { allowed, ignored } = await this.filterMentions(body.mentions, nodeId, user.id);
    const thread = await this.prisma.client.commentThread.create({
      data: {
        nodeId,
        quotedText: body.quotedText,
        createdById: user.id,
        comments: { create: { authorId: user.id, body: body.body, mentions: allowed } },
      },
      include: threadInclude,
    });
    await this.afterComment(user, node, thread.id, body.body, allowed);
    await this.audit.log({
      actorId: user.id,
      action: 'comment.create',
      targetType: 'node',
      targetId: nodeId,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, threadId: thread.id },
      ctx,
    });
    const users = await this.mentionedUsers(allowed);
    return { ...this.threadDto(thread, user, node.role, users), ignoredMentions: ignored };
  }

  async reply(user: AuthenticatedUser, threadId: string, body: ReplyBody, ctx: RequestContext) {
    const { thread, node } = await this.requireThread(user, threadId);
    const { allowed, ignored } = await this.filterMentions(body.mentions, node.id, user.id);
    await this.prisma.client.comment.create({
      data: { threadId, authorId: user.id, body: body.body, mentions: allowed },
    });
    if (thread.status === 'RESOLVED') {
      await this.prisma.client.commentThread.update({
        where: { id: threadId },
        data: { status: 'OPEN', resolvedAt: null, resolvedById: null },
      });
    }
    await this.afterComment(user, node, threadId, body.body, allowed, thread.createdById);
    await this.audit.log({
      actorId: user.id,
      action: 'comment.reply',
      targetType: 'node',
      targetId: node.id,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, threadId },
      ctx,
    });
    return { ...(await this.loadThread(user, threadId, node.role)), ignoredMentions: ignored };
  }

  async edit(user: AuthenticatedUser, commentId: string, body: string) {
    const comment = await this.prisma.client.comment.findFirst({
      where: { id: commentId, deletedAt: null },
    });
    if (!comment) throw AppError.notFound('Comment not found');
    const { node } = await this.requireThread(user, comment.threadId);
    if (comment.authorId !== user.id)
      throw AppError.forbidden('Only the author can edit this comment');
    await this.prisma.client.comment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
    });
    return this.loadThread(user, comment.threadId, node.role);
  }

  async remove(user: AuthenticatedUser, commentId: string, ctx: RequestContext) {
    const comment = await this.prisma.client.comment.findFirst({
      where: { id: commentId, deletedAt: null },
    });
    if (!comment) throw AppError.notFound('Comment not found');
    const { node } = await this.requireThread(user, comment.threadId);
    if (comment.authorId !== user.id && !roleAtLeast(node.role, 'OWNER')) {
      throw AppError.forbidden('Only the author or the document owner can delete this comment');
    }
    await this.prisma.client.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    const left = await this.prisma.client.comment.count({
      where: { threadId: comment.threadId, deletedAt: null },
    });
    if (!left) await this.prisma.client.commentThread.delete({ where: { id: comment.threadId } });
    await this.audit.log({
      actorId: user.id,
      action: 'comment.delete',
      targetType: 'node',
      targetId: node.id,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, threadId: comment.threadId, threadDeleted: !left },
      ctx,
    });
    return { threadDeleted: !left };
  }

  async setStatus(
    user: AuthenticatedUser,
    threadId: string,
    status: ThreadStatus,
    ctx: RequestContext,
  ) {
    const { thread, node } = await this.requireThread(user, threadId);
    if (!this.canResolve(thread.createdById, user.id, node.role)) {
      throw AppError.forbidden('Only editors or the thread author can resolve or reopen');
    }
    await this.prisma.client.commentThread.update({
      where: { id: threadId },
      data:
        status === 'RESOLVED'
          ? { status, resolvedAt: new Date(), resolvedById: user.id }
          : { status, resolvedAt: null, resolvedById: null },
    });
    await this.audit.log({
      actorId: user.id,
      action: status === 'RESOLVED' ? 'comment.resolve' : 'comment.reopen',
      targetType: 'node',
      targetId: node.id,
      workspaceId: node.workspaceId,
      metadata: { name: node.name, threadId },
      ctx,
    });
    return this.loadThread(user, threadId, node.role);
  }

  private async afterComment(
    user: AuthenticatedUser,
    node: { id: string; name: string; workspaceId: string; createdById: string },
    threadId: string,
    body: string,
    mentions: string[],
    threadAuthorId?: string,
  ) {
    const snippet = body.length > SNIPPET ? `${body.slice(0, SNIPPET - 1)}…` : body;
    const base = {
      nodeId: node.id,
      nodeName: node.name,
      workspaceId: node.workspaceId,
      threadId,
      byName: user.name,
      snippet,
    };
    await this.notifications.notify(mentions, 'comment.mention', base);
    const others = [node.createdById, threadAuthorId].filter(
      (id): id is string => Boolean(id) && id !== user.id && !mentions.includes(id!),
    );
    const allowed = (await this.filterMentions(others, node.id, user.id)).allowed;
    await this.notifications.notify(allowed, 'comment.new', base);
  }

  private async filterMentions(ids: string[], nodeId: string, authorId: string) {
    const unique = [...new Set(ids)].filter((id) => id !== authorId);
    if (!unique.length) return { allowed: [] as string[], ignored: [] as string[] };
    const access = await Promise.all(
      unique.map((id) => this.access.resolveMany(id, [nodeId]).then((m) => m.get(nodeId))),
    );
    const allowed = unique.filter((_, i) => access[i]?.role && !access[i]?.deletedAt);
    return { allowed, ignored: unique.filter((id) => !allowed.includes(id)) };
  }

  private async requireThread(user: AuthenticatedUser, threadId: string) {
    const thread = await this.prisma.client.commentThread.findUnique({ where: { id: threadId } });
    if (!thread) throw AppError.notFound('Thread not found');
    const node = await this.documents.requireDocument(user, thread.nodeId, 'VIEWER');
    return { thread, node };
  }

  private async loadThread(user: AuthenticatedUser, threadId: string, role: string) {
    const thread = await this.prisma.client.commentThread.findUniqueOrThrow({
      where: { id: threadId },
      include: threadInclude,
    });
    const users = await this.mentionedUsers(thread.comments.flatMap((c) => c.mentions));
    return this.threadDto(thread, user, role, users);
  }

  private async mentionedUsers(ids: string[]): Promise<Map<string, UserSummary>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.prisma.client.user.findMany({
      where: { id: { in: unique } },
      select: userSummary,
    });
    return new Map(rows.map((u) => [u.id, u]));
  }

  private canResolve(threadAuthorId: string, userId: string, role: string) {
    return threadAuthorId === userId || roleAtLeast(role as 'VIEWER', 'EDITOR');
  }

  private threadDto(
    t: {
      id: string;
      quotedText: string;
      status: ThreadStatus;
      createdById: string;
      createdAt: Date;
      resolvedAt: Date | null;
      createdBy: UserSummary;
      resolvedBy: UserSummary | null;
      comments: Array<{
        id: string;
        body: string;
        authorId: string;
        mentions: string[];
        createdAt: Date;
        editedAt: Date | null;
        author: UserSummary;
      }>;
    },
    user: AuthenticatedUser,
    role: string,
    users: Map<string, UserSummary>,
  ) {
    return {
      id: t.id,
      quotedText: t.quotedText,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt,
      resolvedBy: t.resolvedBy,
      resolvedAt: t.resolvedAt,
      canResolve: this.canResolve(t.createdById, user.id, role),
      comments: t.comments.map((c) => ({
        id: c.id,
        body: c.body,
        author: c.author,
        mentions: c.mentions.map((id) => users.get(id)).filter((u): u is UserSummary => Boolean(u)),
        createdAt: c.createdAt,
        editedAt: c.editedAt,
        canEdit: c.authorId === user.id,
        canDelete: c.authorId === user.id || roleAtLeast(role as 'VIEWER', 'OWNER'),
      })),
    };
  }
}
