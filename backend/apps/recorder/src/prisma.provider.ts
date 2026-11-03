import { createPrismaClient, type PrismaClient } from '@luna/db';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { RECORDER_CONFIG, type RecorderConfig } from './config.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(RECORDER_CONFIG) config: RecorderConfig) {
    this.client = createPrismaClient({
      connectionString: config.DATABASE_URL,
      max: 5,
      connectTimeoutMs: config.DB_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
      idleInTransactionTimeoutMs: config.DB_IDLE_TX_TIMEOUT_MS,
    });
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
