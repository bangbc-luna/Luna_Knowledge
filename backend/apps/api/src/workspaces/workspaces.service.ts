import { Prisma } from '@luna/db';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CollabEventsService } from '../infra/redis/collab-events.service.js';
import { UsersService } from '../users/users.service.js';
import type {
  AddMemberBody,
  CreateWorkspaceBody,
  UpdateWorkspaceBody,
} from './workspaces.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly collab: CollabEventsService,
  ) {}

  async requireAccess(actor: AuthenticatedUser, workspaceId: string, { admin = false } = {}) {
    const workspace = await this.prisma.client.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, members: { where: { userId: actor.id }, select: { role: true } } },
    });
    const isMember = !!workspace?.members.length;
    if (!workspace || (!isMember && !actor.isSystemAdmin)) {
      throw AppError.notFound('Workspace not found');
    }
    if (admin && !actor.isSystemAdmin) {
      throw AppError.forbidden('Only a system admin can do this');
    }
    return { workspaceId, isMember };
  }

  async list(actor: AuthenticatedUser, scope: 'mine' | 'all') {
    if (scope === 'all' && !actor.isSystemAdmin) throw AppError.forbidden('System admin only');
    const rows = await this.prisma.client.workspace.findMany({
      where: {
        deletedAt: null,
        ...(scope === 'mine' ? { members: { some: { userId: actor.id } } } : {}),
      },
      include: {
        _count: { select: { members: true } },
        members: { where: { userId: actor.id }, select: { role: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((w) => this.toDto(w));
  }

  async get(actor: AuthenticatedUser, workspaceId: string) {
    await this.requireAccess(actor, workspaceId);
    return this.toDto(await this.loadWithCounts(workspaceId, actor.id));
  }

  async create(actor: AuthenticatedUser, body: CreateWorkspaceBody, ctx: RequestContext) {
    const members = await Promise.all(body.memberEmails.map((e) => this.users.findOrProvision(e)));
    try {
      const workspace = await this.prisma.client.workspace.create({
        data: {
          name: body.name,
          slug: body.slug,
          description: body.description,
          icon: body.icon,
          createdById: actor.id,
          members: {
            create: [...new Map(members.map((m) => [m.id, m])).values()].map((m) => ({
              userId: m.id,
              role: 'MEMBER' as const,
              addedById: actor.id,
            })),
          },
        },
      });
      await this.audit.log({
        actorId: actor.id,
        action: 'workspace.create',
        targetType: 'workspace',
        targetId: workspace.id,
        workspaceId: workspace.id,
        metadata: { slug: body.slug, memberIds: members.map((m) => m.id) },
        ctx,
      });
      return this.toDto(await this.loadWithCounts(workspace.id, actor.id));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict(`Slug "${body.slug}" is already taken`);
      }
      throw err;
    }
  }

  async update(
    actor: AuthenticatedUser,
    workspaceId: string,
    body: UpdateWorkspaceBody,
    ctx: RequestContext,
  ) {
    await this.requireAccess(actor, workspaceId, { admin: true });
    await this.prisma.client.workspace.update({ where: { id: workspaceId }, data: body });
    await this.audit.log({
      actorId: actor.id,
      action: 'workspace.update',
      targetType: 'workspace',
      targetId: workspaceId,
      workspaceId,
      metadata: body,
      ctx,
    });
    return this.toDto(await this.loadWithCounts(workspaceId, actor.id));
  }

  async remove(actor: AuthenticatedUser, workspaceId: string, ctx: RequestContext) {
    await this.requireAccess(actor, workspaceId, { admin: true });
    const ws = await this.prisma.client.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    await this.prisma.client.workspace.update({
      where: { id: workspaceId },
      data: { deletedAt: new Date(), slug: `${ws.slug}--deleted-${Date.now()}` },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'workspace.delete',
      targetType: 'workspace',
      targetId: workspaceId,
      workspaceId,
      metadata: { slug: ws.slug },
      ctx,
    });
    await this.collab.accessChanged({ workspaceId });
  }

  async listMembers(actor: AuthenticatedUser, workspaceId: string) {
    await this.requireAccess(actor, workspaceId);
    const members = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId },
      select: { role: true, createdAt: true, user: { select: userSummary } },
    });
    return members.sort((a, b) => a.user.name.localeCompare(b.user.name, 'vi'));
  }

  async addMember(
    actor: AuthenticatedUser,
    workspaceId: string,
    body: AddMemberBody,
    ctx: RequestContext,
  ) {
    await this.requireAccess(actor, workspaceId, { admin: true });
    const user = await this.users.findOrProvision(body.email);
    try {
      const member = await this.prisma.client.workspaceMember.create({
        data: { workspaceId, userId: user.id, role: 'MEMBER', addedById: actor.id },
        select: { role: true, createdAt: true, user: { select: userSummary } },
      });
      await this.auditMember(actor, workspaceId, 'workspace.member_add', user.id, {}, ctx);
      await this.collab.accessChanged({ workspaceId, userId: user.id });
      return member;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict('User is already a member of this workspace');
      }
      throw err;
    }
  }

  async removeMember(
    actor: AuthenticatedUser,
    workspaceId: string,
    userId: string,
    ctx: RequestContext,
  ) {
    await this.requireAccess(actor, workspaceId, { admin: userId !== actor.id });
    await this.findMember(workspaceId, userId);
    await this.prisma.client.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    await this.auditMember(actor, workspaceId, 'workspace.member_remove', userId, {}, ctx);
    await this.collab.accessChanged({ workspaceId, userId });
  }

  private async findMember(workspaceId: string, userId: string) {
    const member = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) throw AppError.notFound('Member not found');
    return member;
  }

  private loadWithCounts(workspaceId: string, actorId: string) {
    return this.prisma.client.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: {
        _count: { select: { members: true } },
        members: { where: { userId: actorId }, select: { role: true } },
      },
    });
  }

  private toDto(w: Awaited<ReturnType<WorkspacesService['loadWithCounts']>>) {
    return {
      id: w.id,
      name: w.name,
      slug: w.slug,
      description: w.description,
      icon: w.icon,
      createdAt: w.createdAt,
      memberCount: w._count.members,
      myRole: w.members[0]?.role ?? null,
    };
  }

  private auditMember(
    actor: AuthenticatedUser,
    workspaceId: string,
    action: string,
    userId: string,
    metadata: Prisma.InputJsonObject,
    ctx: RequestContext,
  ) {
    return this.audit.log({
      actorId: actor.id,
      action,
      targetType: 'user',
      targetId: userId,
      workspaceId,
      metadata,
      ctx,
    });
  }
}
