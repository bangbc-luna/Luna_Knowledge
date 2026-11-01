import { type AuditAction, Prisma, type WorkspaceKind, type WorkspaceRole } from '@luna/db';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { SearchQueueService } from '../infra/queue/search-queue.service.js';
import { CollabEventsService } from '../infra/redis/collab-events.service.js';
import { UsersService } from '../users/users.service.js';
import type {
  AddMemberBody,
  CreateWorkspaceBody,
  UpdateMemberBody,
  UpdateWorkspaceBody,
} from './workspaces.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const ROLE_ORDER: WorkspaceRole[] = ['ADMIN', 'MEMBER', 'VIEWER'];

interface Access {
  workspaceId: string;
  kind: WorkspaceKind;
  myRole: WorkspaceRole | null;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly search: SearchQueueService,
    private readonly collab: CollabEventsService,
  ) {}

  async requireAccess(
    actor: AuthenticatedUser,
    workspaceId: string,
    { admin = false } = {},
  ): Promise<Access> {
    const workspace = await this.prisma.client.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        members: { where: { userId: actor.id }, select: { role: true } },
      },
    });
    const myRole = workspace?.members[0]?.role ?? null;
    if (!workspace || (!myRole && !actor.isSystemAdmin)) {
      throw AppError.notFound('Workspace not found');
    }
    if (admin && !actor.isSystemAdmin && myRole !== 'ADMIN') {
      throw AppError.forbidden('Only workspace admins can do this');
    }
    return { workspaceId, kind: workspace.kind, myRole };
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
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map((w) => this.toDto(w));
  }

  async get(actor: AuthenticatedUser, workspaceId: string) {
    await this.requireAccess(actor, workspaceId);
    return this.toDto(await this.loadWithCounts(workspaceId, actor.id));
  }

  async create(actor: AuthenticatedUser, body: CreateWorkspaceBody, ctx: RequestContext) {
    const invited = await Promise.all(body.memberEmails.map((e) => this.users.findOrProvision(e)));
    const members = [
      ...new Map(invited.filter((u) => u.id !== actor.id).map((u) => [u.id, u])).values(),
    ];
    try {
      const workspace = await this.prisma.client.workspace.create({
        data: {
          name: body.name,
          slug: body.slug,
          description: body.description,
          icon: body.icon,
          kind: 'TEAM',
          createdById: actor.id,
          members: {
            create: [
              { userId: actor.id, role: 'ADMIN' as const, addedById: actor.id },
              ...members.map((m) => ({
                userId: m.id,
                role: 'MEMBER' as const,
                addedById: actor.id,
              })),
            ],
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
    const access = await this.requireAccess(actor, workspaceId, { admin: true });
    if (access.kind === 'COMPANY')
      throw AppError.forbidden('The company workspace cannot be deleted');
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
    await this.search.dropWorkspace(workspaceId);
    await this.collab.accessChanged({ workspaceId });
  }

  async listMembers(actor: AuthenticatedUser, workspaceId: string) {
    await this.requireAccess(actor, workspaceId);
    const members = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId },
      select: { role: true, createdAt: true, user: { select: userSummary } },
    });
    return members.sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        a.user.name.localeCompare(b.user.name, 'vi'),
    );
  }

  async addMember(
    actor: AuthenticatedUser,
    workspaceId: string,
    body: AddMemberBody,
    ctx: RequestContext,
  ) {
    const access = await this.requireAccess(actor, workspaceId, { admin: true });
    this.assertRoleFits(access.kind, body.role);
    const user = await this.users.findOrProvision(body.email);
    if (access.kind === 'COMPANY') {
      return this.setRole(actor, workspaceId, user.id, body.role, ctx);
    }
    try {
      const member = await this.prisma.client.workspaceMember.create({
        data: { workspaceId, userId: user.id, role: body.role, addedById: actor.id },
        select: { role: true, createdAt: true, user: { select: userSummary } },
      });
      await this.auditMember(
        actor,
        workspaceId,
        'workspace.member_add',
        user.id,
        { role: body.role },
        ctx,
      );
      await this.collab.accessChanged({ workspaceId, userId: user.id });
      return member;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw AppError.conflict('User is already a member of this workspace');
      }
      throw err;
    }
  }

  async updateMember(
    actor: AuthenticatedUser,
    workspaceId: string,
    userId: string,
    body: UpdateMemberBody,
    ctx: RequestContext,
  ) {
    const access = await this.requireAccess(actor, workspaceId, { admin: true });
    this.assertRoleFits(access.kind, body.role);
    await this.findMember(workspaceId, userId);
    return this.setRole(actor, workspaceId, userId, body.role, ctx);
  }

  async removeMember(
    actor: AuthenticatedUser,
    workspaceId: string,
    userId: string,
    ctx: RequestContext,
  ) {
    const access = await this.requireAccess(actor, workspaceId, { admin: userId !== actor.id });
    if (access.kind === 'COMPANY') {
      throw AppError.forbidden('Everyone in the company stays in the company workspace');
    }
    const target = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (!member) throw AppError.notFound('Member not found');
      if (member.role === 'ADMIN') await this.assertAnotherAdmin(tx, workspaceId, userId);
      await tx.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
      return member;
    });
    await this.auditMember(
      actor,
      workspaceId,
      'workspace.member_remove',
      userId,
      { role: target.role },
      ctx,
    );
    await this.collab.accessChanged({ workspaceId, userId });
  }

  private async setRole(
    actor: AuthenticatedUser,
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    ctx: RequestContext,
  ) {
    const { current, member } = await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      const before = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (before?.role === 'ADMIN' && role !== 'ADMIN') {
        await this.assertAnotherAdmin(tx, workspaceId, userId);
      }
      const after = await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId } },
        create: { workspaceId, userId, role, addedById: actor.id },
        update: { role },
        select: { role: true, createdAt: true, user: { select: userSummary } },
      });
      return { current: before, member: after };
    });
    if (current?.role !== role) {
      await this.auditMember(
        actor,
        workspaceId,
        current ? 'workspace.member_update' : 'workspace.member_add',
        userId,
        current ? { from: current.role, to: role } : { role },
        ctx,
      );
      await this.collab.accessChanged({ workspaceId, userId });
    }
    return member;
  }

  private assertRoleFits(kind: WorkspaceKind, role: WorkspaceRole) {
    if (kind === 'TEAM' && role === 'VIEWER') {
      throw AppError.validation(
        'Team workspaces have admins and members only; share a folder for view-only access',
      );
    }
  }

  private async assertAnotherAdmin(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
  ) {
    const others = await tx.workspaceMember.count({
      where: { workspaceId, role: 'ADMIN', userId: { not: userId } },
    });
    if (!others) throw AppError.validation('A workspace needs at least one admin');
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
      kind: w.kind,
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
    action: AuditAction,
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
