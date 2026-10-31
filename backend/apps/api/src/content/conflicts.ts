import { Prisma } from '@luna/db';

const TREE_VIOLATION = 'LT001';
const LOCK_NOT_AVAILABLE = '55P03';
const QUERY_ERROR_CODES = new Set(['P2010', 'P2039']);

function postgresCode(err: Prisma.PrismaClientKnownRequestError): unknown {
  return (err.meta?.driverAdapterError as { cause?: { code?: unknown } } | undefined)?.cause?.code;
}

export function isNameConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = JSON.stringify(err.meta ?? {});
  return target.includes('nodes_unique_name') || target.includes('name_normalized');
}

export function isTreeViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (postgresCode(err) === TREE_VIOLATION) return true;
  if (!QUERY_ERROR_CODES.has(err.code)) return false;
  return err.message.includes(`\`${TREE_VIOLATION}\``) || /`tree: /.test(err.message);
}

export function isTreeBusy(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return err.code === 'P2028' || postgresCode(err) === LOCK_NOT_AVAILABLE;
}
