import type { Request } from 'express';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLocalRequest(req: Request): boolean {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')) return false;
  return !Object.keys(req.headers).some((h) => h === 'forwarded' || h.startsWith('x-forwarded-'));
}
