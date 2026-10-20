import { createPrismaClient, type PrismaClient } from '@luna/db';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

/** Bọc PrismaClient để Nest quản lý vòng đời kết nối. Dùng `prisma.client.<model>`. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = createPrismaClient({ connectionString: config.DATABASE_URL });
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
