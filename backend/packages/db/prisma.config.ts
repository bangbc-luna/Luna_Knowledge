import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Monorepo dùng chung một file .env ở thư mục gốc.
config({ path: new URL('../../.env', import.meta.url).pathname, quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // `prisma generate` không cần kết nối DB (build Docker/CI không có DATABASE_URL);
  // các lệnh migrate sẽ báo lỗi rõ ràng nếu thiếu.
  datasource: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : undefined,
});
