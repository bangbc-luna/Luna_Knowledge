// Cấp quyền System Admin cho một email công ty: `pnpm admin:grant ten@lunatech.vn`.
// Dùng khi khởi tạo hệ thống hoặc khi không còn admin nào đăng nhập được.
import { createPrismaClient } from '@luna/db';
import { databaseEnvSchema, loadEnv } from '@luna/shared';
import { z } from 'zod';

const email = z.email().safeParse(process.argv[2]?.trim().toLowerCase());
if (!email.success) {
  console.error('Usage: pnpm admin:grant <email@lunatech.vn>');
  process.exit(1);
}

const env = loadEnv(databaseEnvSchema.extend({ ALLOWED_GOOGLE_DOMAINS: z.string().min(1) }));
const domain = email.data.split('@')[1]!;
const allowed = env.ALLOWED_GOOGLE_DOMAINS.split(',').map((d) => d.trim());
if (!allowed.includes(domain)) {
  console.error(
    `Email domain "${domain}" is not in ALLOWED_GOOGLE_DOMAINS (${allowed.join(', ')})`,
  );
  process.exit(1);
}

const prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 1 });
try {
  const user = await prisma.user.upsert({
    where: { email: email.data },
    create: { email: email.data, name: email.data.split('@')[0]!, isSystemAdmin: true },
    update: { isSystemAdmin: true, status: 'ACTIVE' },
  });
  await prisma.auditLog.create({
    data: { action: 'user.grant_system_admin_cli', targetType: 'user', targetId: user.id },
  });
  console.log(`✔ ${user.email} is now a System Admin.`);
} finally {
  await prisma.$disconnect();
}
