import { config } from 'dotenv';
import { createPrismaClient } from '../src/index.js';

config({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true });

const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL!, max: 2 });

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@lunatech.vn';

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isSystemAdmin: true },
    create: { email: adminEmail, name: 'System Admin', isSystemAdmin: true },
  });

  const [editor, viewer] = await Promise.all(
    [
      { email: 'editor.demo@lunatech.vn', name: 'Editor Demo' },
      { email: 'viewer.demo@lunatech.vn', name: 'Viewer Demo' },
    ].map((u) => prisma.user.upsert({ where: { email: u.email }, update: {}, create: u })),
  );

  const workspaces = [
    { slug: 'marketing', name: 'Marketing', description: 'Tài liệu và video của team Marketing' },
    { slug: 'engineering', name: 'Engineering', description: 'Tài liệu kỹ thuật' },
  ];

  for (const ws of workspaces) {
    const workspace = await prisma.workspace.upsert({
      where: { slug: ws.slug },
      update: {},
      create: { ...ws, createdById: admin.id },
    });
    const members = [
      { userId: admin.id, role: 'OWNER' as const },
      { userId: editor.id, role: 'EDITOR' as const },
      { userId: viewer.id, role: 'VIEWER' as const },
    ];
    for (const m of members) {
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: m.userId } },
        update: {},
        create: { workspaceId: workspace.id, ...m, addedById: admin.id },
      });
    }
  }

  console.log(`Seeded admin ${admin.email}, 2 demo users, ${workspaces.length} workspaces.`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
