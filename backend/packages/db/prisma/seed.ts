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

  const [member1, member2] = await Promise.all(
    [
      { email: 'member1.demo@lunatech.vn', name: 'Member One Demo' },
      { email: 'member2.demo@lunatech.vn', name: 'Member Two Demo' },
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
      { userId: admin.id, role: 'ADMIN' as const },
      { userId: member1.id, role: 'MEMBER' as const },
      { userId: member2.id, role: 'MEMBER' as const },
    ];
    for (const m of members) {
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: m.userId } },
        update: {},
        create: { workspaceId: workspace.id, ...m, addedById: admin.id },
      });
    }
  }

  const shared =
    (await prisma.workspace.findFirst({ where: { kind: 'COMPANY', deletedAt: null } })) ??
    (await prisma.workspace.upsert({
      where: { slug: 'lunatech' },
      update: { kind: 'COMPANY' },
      create: {
        slug: 'lunatech',
        name: 'LunaTech',
        kind: 'COMPANY',
        description: 'Tài liệu và video dùng chung toàn công ty',
        createdById: admin.id,
      },
    }));
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: shared.id, userId: admin.id } },
    update: { role: 'ADMIN' },
    create: { workspaceId: shared.id, userId: admin.id, role: 'ADMIN', addedById: admin.id },
  });
  const everyone = await prisma.user.findMany({
    where: { status: 'ACTIVE', id: { not: admin.id } },
    select: { id: true },
  });
  const { count } = await prisma.workspaceMember.createMany({
    data: everyone.map((u) => ({
      workspaceId: shared.id,
      userId: u.id,
      role: 'VIEWER' as const,
      addedById: admin.id,
    })),
    skipDuplicates: true,
  });
  console.log(`Company workspace ${shared.name}: added ${count} existing users as viewers.`);

  console.log(`Seeded admin ${admin.email}, 2 demo users, ${workspaces.length} workspaces.`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
