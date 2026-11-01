import { Prisma } from '@luna/db';
import { AppError } from './app-error.js';

export async function mapUnique<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict(message);
    }
    throw err;
  }
}
