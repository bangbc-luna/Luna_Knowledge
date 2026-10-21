import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';
export * from './maintenance.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  max?: number;
}

export function createPrismaClient({ connectionString, max = 10 }: CreatePrismaClientOptions) {
  const adapter = new PrismaPg({ connectionString, max });
  return new PrismaClient({ adapter });
}
