import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createPrismaClient } from '@luna/db';
import { SignJWT } from 'jose';
import { z } from 'zod';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    viewers: { type: 'string', default: '150' },
    editors: { type: 'string', default: '30' },
    out: { type: 'string', default: '../tests/load/.seed.json' },
    yes: { type: 'boolean', default: false },
  },
});
if (!values.yes) {
  console.error(
    'load-seed writes users, a workspace and sessions straight into DATABASE_URL and signs tokens with JWT_ACCESS_SECRET. Re-run with --yes to confirm.',
  );
  process.exit(1);
}

const env = z
  .object({ DATABASE_URL: z.string().min(1), JWT_ACCESS_SECRET: z.string().min(16) })
  .parse(process.env);
const viewerCount = z.coerce.number().int().min(1).parse(values.viewers);
const editorCount = z.coerce.number().int().min(1).parse(values.editors);

const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const sessionTtlMs = 12 * 3600 * 1000;
const prisma = createPrismaClient({ connectionString: env.DATABASE_URL, max: 2 });

async function provision(email: string, name: string): Promise<{ id: string; token: string }> {
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name },
    update: { status: 'ACTIVE' },
  });
  const session = await prisma.session.create({
    data: { userId: user.id, absoluteExpiresAt: new Date(Date.now() + sessionTtlMs) },
  });
  const token = await new SignJWT({ sid: session.id, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('luna-api')
    .setAudience('luna')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(key);
  return { id: user.id, token };
}

try {
  const lead = await provision('load.lead@lunatech.vn', 'Load Lead');
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'load-peak' },
    create: { name: 'Load peak', slug: 'load-peak', createdById: lead.id },
    update: { deletedAt: null },
  });
  const member = (userId: string, role: 'ADMIN' | 'MEMBER' | 'VIEWER') =>
    prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      create: { workspaceId: workspace.id, userId, role, addedById: lead.id },
      update: { role },
    });
  await member(lead.id, 'ADMIN');

  const editors: string[] = [];
  for (let i = 0; i < editorCount; i++) {
    const u = await provision(`load.e${i}@lunatech.vn`, `Load Editor ${i}`);
    await member(u.id, 'MEMBER');
    editors.push(u.token);
  }
  const viewers: string[] = [];
  for (let i = 0; i < viewerCount; i++) {
    const u = await provision(`load.v${i}@lunatech.vn`, `Load Viewer ${i}`);
    await member(u.id, 'VIEWER');
    viewers.push(u.token);
  }

  await writeFile(
    values.out,
    JSON.stringify({ wsId: workspace.id, lead: lead.token, editors, viewers }),
  );
  console.log(
    `seeded ${editorCount} editors and ${viewerCount} viewers in ${workspace.slug} -> ${values.out}`,
  );
} finally {
  await prisma.$disconnect();
}
