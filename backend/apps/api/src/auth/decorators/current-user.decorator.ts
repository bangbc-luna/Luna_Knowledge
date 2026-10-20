import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext } from '../auth.service.js';

export type AuthenticatedRequest = { auth?: AuthContext };

/** `@CurrentUser() user: AuthenticatedUser` — user của access token hiện tại. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user,
);

/** `@CurrentSession() sessionId: string`. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.sessionId,
);
