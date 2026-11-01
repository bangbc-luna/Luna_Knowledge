import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';
export * from './audit.js';
export * from './maintenance.js';
export * from './tree-lock.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  max?: number;
  connectTimeoutMs?: number;
  statementTimeoutMs?: number;
  idleInTransactionTimeoutMs?: number;
}

export function createPrismaClient({
  connectionString,
  max = 10,
  connectTimeoutMs = 5000,
  statementTimeoutMs = 30_000,
  idleInTransactionTimeoutMs = 60_000,
}: CreatePrismaClientOptions) {
  const adapter = new PrismaPg({
    connectionString,
    max,
    connectionTimeoutMillis: connectTimeoutMs,
    statement_timeout: statementTimeoutMs,
    idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
  });
  return new PrismaClient({ adapter });
}
export * from './access.js';
export * from './documents.js';
export * from './roles.js';
