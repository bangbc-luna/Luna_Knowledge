import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext } from '../auth.service.js';

export type AuthenticatedRequest = { auth?: AuthContext };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user,
);

export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.sessionId,
);
