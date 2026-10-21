const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

const INFRA_ERROR_NAMES = new Set(['PrismaClientInitializationError', 'MaxRetriesPerRequestError']);

export function isInfrastructureError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 5) return false;
  const e = err as { name?: string; code?: unknown; cause?: unknown; errors?: unknown[] };
  if (e.name && INFRA_ERROR_NAMES.has(e.name)) return true;
  if (typeof e.code === 'string' && NETWORK_CODES.has(e.code)) return true;
  if (Array.isArray(e.errors) && e.errors.some((x) => isInfrastructureError(x, depth + 1))) {
    return true;
  }
  return isInfrastructureError(e.cause, depth + 1);
}

export function describeError(err: unknown, depth = 0): string {
  if (!err || typeof err !== 'object' || depth > 5) return String(err);
  const e = err as {
    name?: string;
    code?: unknown;
    message?: string;
    cause?: unknown;
    errors?: unknown[];
  };
  if (typeof e.code === 'string' && NETWORK_CODES.has(e.code)) return e.code;
  for (const inner of [...(e.errors ?? []), e.cause]) {
    if (isInfrastructureError(inner)) return describeError(inner, depth + 1);
  }
  if (e.name && e.name !== 'Error') return e.name;
  return (e.message ?? 'Unknown error').trim().split('\n')[0]!;
}
