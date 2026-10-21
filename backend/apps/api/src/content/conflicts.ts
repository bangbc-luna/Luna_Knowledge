import { Prisma } from '@luna/db';

export function isNameConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = JSON.stringify(err.meta ?? {});
  return target.includes('nodes_unique_name') || target.includes('name_normalized');
}
