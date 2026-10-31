import { Prisma } from '@luna/db';

const TREE_VIOLATION = 'LT001';

export function isNameConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = JSON.stringify(err.meta ?? {});
  return target.includes('nodes_unique_name') || target.includes('name_normalized');
}

export function isTreeViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const cause = (err.meta?.driverAdapterError as { cause?: { code?: unknown } } | undefined)?.cause;
  if (cause?.code === TREE_VIOLATION) return true;
  return err.message.includes(`\`${TREE_VIOLATION}\``) || /`tree: /.test(err.message);
}
