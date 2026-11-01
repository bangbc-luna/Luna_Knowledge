import type { AuditAction } from '@luna/db';
import { Logger } from '@nestjs/common';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('writes through writeAudit with the request ip and user agent', async () => {
    const create = vi.fn().mockResolvedValue({});
    const svc = new AuditService({ client: { auditLog: { create } } } as never, {} as never);
    await svc.log({
      actorId: 'u1',
      action: 'node.create',
      targetType: 'node',
      targetId: 'n1',
      workspaceId: 'w1',
      metadata: { a: 1 },
      ctx: { ip: '10.0.0.1', userAgent: 'ua' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'u1',
        action: 'node.create',
        targetType: 'node',
        targetId: 'n1',
        workspaceId: 'w1',
        metadata: { a: 1 },
        ip: '10.0.0.1',
        userAgent: 'ua',
      },
    });
  });

  it('swallows database errors', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const create = vi.fn().mockRejectedValue(new Error('down'));
    const svc = new AuditService({ client: { auditLog: { create } } } as never, {} as never);
    await expect(svc.log({ actorId: null, action: 'auth.login_failed' })).resolves.toBeUndefined();
  });

  it('only accepts declared audit actions', () => {
    expectTypeOf<'node.create'>().toMatchTypeOf<AuditAction>();
    expectTypeOf<'node.bogus'>().not.toMatchTypeOf<AuditAction>();
  });
});
