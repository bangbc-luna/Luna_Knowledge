import { Prisma, type WorkspaceRole } from '@luna/db';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { roleAtLeast } from './workspace-roles.js';
import type {
  AddMemberBody,
  CreateWorkspaceBody,
  UpdateMemberBody,
  UpdateWorkspaceBody,
} from './workspaces.schemas.js';

const userSummary = { id: true, email: true, name: true, avatarUrl: true } as const;
const ROLE_ORDER: WorkspaceRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

interface Access {
  workspaceId: string;
  /** Vai trò thành viên thật; null nếu là System Admin không thuộc workspace. */
  memberRole: WorkspaceRole | null;
  /** Vai trò dùng để phân quyền quản trị: System Admin được coi như OWNER. */
  effectiveRole: WorkspaceRole;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- Access

  /**
   * Kiểm tra quyền trên workspace. Không phải thành viên → 404 (không lộ sự tồn tại).
   * System Admin có quyền quản trị mọi workspace (SPEC §3.1); quyền xem nội dung xét ở Phase 2.
   */
  async requireRole(
    actor: AuthenticatedUser,
    workspaceId: string,
    min: WorkspaceRole,
  ): Promise<Access> {
    const workspace = await this.prisma.client.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, members: { where: { userId: actor.id }, select: { role: true } } },
    });
    const memberRole = workspace?.members[0]?.role ?? null;
    if (!workspace || (!memberRole && !actor.isSystemAdmin)) {
      throw AppError.notFound('Workspace not found');
    }
    const effectiveRole = actor.isSystemAdmin ? 'OWNER' : memberRole!;
    if (!roleAtLeast(effectiveRole, min)) {
      throw AppError.forbidden(`Requires ${min} role in this workspace`);
    }
    return { workspaceId, memberRole, effectiveRole };
  }

  // ---------------------------------------------------------------- Workspaces

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
    // Chủ sở hữu của từng workspace (màn Workspace ở trang admin cần biết ai chịu trách nhiệm).
    const owners = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId: { in: rows.map((w) => w.id) }, role: 'OWNER' },
      select: { workspaceId: true, user: { select: userSummary } },
    });
    const ownerMap = new Map(owners.map((o) => [o.workspaceId, o.user]));
    return rows.map((w) => ({ ...this.toDto(w), owner: ownerMap.get(w.id) ?? null }));
  }

  async get(actor: AuthenticatedUser, workspaceId: string) {
    await this.requireRole(actor, workspaceId, 'VIEWER');
    return this.toDto(await this.loadWithCounts(workspaceId, actor.id));
  }

  async create(actor: AuthenticatedUser, body: CreateWorkspaceBody, ctx: RequestContext) {
    const owner = await this.users.findOrProvision(body.ownerEmail);
    try {
      const workspace = await this.prisma.client.workspace.create({
        data: {
          name: body.name,
          slug: body.slug,
          description: body.description,
          icon: body.icon,
          createdById: actor.id,
          members: { create: { userId: owner.id, role: 'OWNER', addedById: actor.id } },
        },
      });
      await this.audit.log({
        actorId: actor.id,
        action: 'workspace.create',
        targetType: 'workspace',
        targetId: workspace.id,
        workspaceId: workspace.id,
        metadata: { slug: body.slug, ownerId: owner.id },
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
    await this.requireRole(actor, workspaceId, 'OWNER');
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

  /** Xóa mềm; slug được giải phóng để tạo lại workspace cùng tên. */
  async remove(actor: AuthenticatedUser, workspaceId: string, ctx: RequestContext) {
    await this.requireRole(actor, workspaceId, 'OWNER');
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
  }

  // ---------------------------------------------------------------- Members

  async listMembers(actor: AuthenticatedUser, workspaceId: string) {
    await this.requireRole(actor, workspaceId, 'VIEWER');
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
    await this.requireRole(actor, workspaceId, 'ADMIN');
    const user = await this.users.findOrProvision(body.email);

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
    await this.requireRole(actor, workspaceId, 'ADMIN');
    const target = await this.findMember(workspaceId, userId);
    if (target.role === 'OWNER') {
      throw AppError.forbidden('Owner role can only change via ownership transfer');
    }
    const member = await this.prisma.client.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { role: body.role },
      select: { role: true, createdAt: true, user: { select: userSummary } },
    });
    await this.auditMember(
      actor,
      workspaceId,
      'workspace.member_update',
      userId,
      {
        from: target.role,
        to: body.role,
      },
      ctx,
    );
    return member;
  }

  /** ADMIN trở lên xóa thành viên khác; ai cũng có thể tự rời workspace (trừ OWNER). */
  async removeMember(
    actor: AuthenticatedUser,
    workspaceId: string,
    userId: string,
    ctx: RequestContext,
  ) {
    await this.requireRole(actor, workspaceId, userId === actor.id ? 'VIEWER' : 'ADMIN');
    const target = await this.findMember(workspaceId, userId);
    if (target.role === 'OWNER') {
      throw AppError.forbidden('Transfer ownership before removing the owner');
    }
    await this.prisma.client.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    await this.auditMember(
      actor,
      workspaceId,
      'workspace.member_remove',
      userId,
      {
        role: target.role,
      },
      ctx,
    );
  }

  async transferOwnership(
    actor: AuthenticatedUser,
    workspaceId: string,
    newOwnerId: string,
    ctx: RequestContext,
  ) {
    await this.requireRole(actor, workspaceId, 'OWNER');
    const target = await this.findMember(workspaceId, newOwnerId);
    if (target.role === 'OWNER') throw AppError.validation('User is already the owner');

    await this.prisma.client.$transaction([
      this.prisma.client.workspaceMember.updateMany({
        where: { workspaceId, role: 'OWNER' },
        data: { role: 'ADMIN' },
      }),
      this.prisma.client.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: newOwnerId } },
        data: { role: 'OWNER' },
      }),
    ]);
    await this.auditMember(actor, workspaceId, 'workspace.transfer_ownership', newOwnerId, {}, ctx);
    return this.listMembers(actor, workspaceId);
  }

  // ---------------------------------------------------------------- Helpers

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
