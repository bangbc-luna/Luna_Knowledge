import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './decorators/current-user.decorator.js';
import { IS_PUBLIC } from './decorators/public.decorator.js';
import { REQUIRE_SYSTEM_ADMIN } from './decorators/system-admin.decorator.js';

/** Guard toàn cục: mọi route cần `Authorization: Bearer <accessToken>` trừ khi có `@Public()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw AppError.unauthenticated();

    req.auth = await this.auth.authenticate(token);

    if (
      this.reflector.getAllAndOverride<boolean>(REQUIRE_SYSTEM_ADMIN, targets) &&
      !req.auth.user.isSystemAdmin
    ) {
      throw AppError.forbidden('System admin only');
    }
    return true;
  }
}
