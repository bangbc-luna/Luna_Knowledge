import type { Request } from 'express';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export function viaTunnel(req: Request): boolean {
  const ip = req.headers['cf-connecting-ip'];
  return typeof ip === 'string' && ip.trim() !== '';
}

export function requestContext(req: Request): RequestContext {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null };
}
