import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../../auth/decorators/current-user.decorator.js';

const SKIP = [/^\/health/, /^\/metrics$/];

@Injectable()
export class LunaThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as Request & AuthenticatedRequest;
    const userId = r.auth?.user.id;
    return userId ? `u:${userId}` : `ip:${r.ip ?? 'unknown'}`;
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    return SKIP.some((re) => re.test(req.path));
  }
}
