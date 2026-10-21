import type { Prisma } from '@luna/db';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthService, type AuthenticatedUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { RequestContext } from '../common/http/request-context.js';
import { toPage } from '../common/pagination/cursor.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CollabEventsService } from '../infra/redis/collab-events.service.js';
import type { AdminListUsersQuery, AdminUpdateUserBody } from './users.schemas.js';

const summarySelect = { id: true, email: true, name: true, avatarUrl: true } as const;
const adminSelect = {
  ...summarySelect,
  isSystemAdmin: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly collab: CollabEventsService,
  ) {}

  async me(user: AuthenticatedUser) {
    const memberships = await this.prisma.client.workspaceMember.findMany({
      where: { userId: user.id, workspace: { deletedAt: null } },
      include: { workspace: { select: { id: true, name: true, slug: true, icon: true } } },
      orderBy: { workspace: { name: 'asc' } },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isSystemAdmin: user.isSystemAdmin,
      workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })),
    };
  }

  async search(q: string, limit: number) {
    return this.prisma.client.user.findMany({
      where: { status: 'ACTIVE', ...this.textFilter(q) },
      select: summarySelect,
      orderBy: { name: 'asc' },
      take: limit,
    });
  }

  async adminList(query: AdminListUsersQuery) {
    const rows = await this.prisma.client.user.findMany({
      where: { status: query.status, ...(query.q ? this.textFilter(query.q) : {}) },
      select: adminSelect,
      orderBy: { id: 'asc' },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: query.limit + 1,
    });
    return toPage(rows, query.limit);
  }

  async adminUpdate(
    actor: AuthenticatedUser,
    userId: string,
    body: AdminUpdateUserBody,
    ctx: RequestContext,
  ) {
    if (userId === actor.id) throw AppError.forbidden('You cannot change your own account here');

    const existing = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!existing) throw AppError.notFound('User not found');

    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: body,
      select: adminSelect,
    });
    if (body.status === 'DISABLED' && existing.status !== 'DISABLED') {
      await this.auth.revokeAllSessions(userId, 'account_disabled');
      await this.collab.accessChanged({ userId });
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'user.update',
      targetType: 'user',
      targetId: userId,
      metadata: {
        before: { status: existing.status, isSystemAdmin: existing.isSystemAdmin },
        after: body,
      },
      ctx,
    });
    return user;
  }

  async systemAdmins(): Promise<
    Array<{ id: string; email: string; name: string; avatarUrl: string | null }>
  > {
    return this.prisma.client.user.findMany({
      where: { isSystemAdmin: true, status: 'ACTIVE' },
      select: { id: true, email: true, name: true, avatarUrl: true },
      orderBy: { name: 'asc' },
      take: 10,
    });
  }

  async findOrProvision(email: string) {
    if (!this.auth.isAllowedEmail(email)) {
      throw AppError.validation(`Only company accounts are allowed (${email})`);
    }
    const existing = await this.prisma.client.user.findUnique({ where: { email } });
    const user =
      existing ??
      (await this.prisma.client.user.upsert({
        where: { email },
        create: { email, name: email.split('@')[0]! },
        update: {},
      }));
    if (!existing) await this.auth.joinDefaultWorkspace(user.id);
    if (user.status === 'DISABLED') throw AppError.validation('User account is disabled');
    return user;
  }

  private textFilter(q: string): Prisma.UserWhereInput {
    return {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    };
  }
}
