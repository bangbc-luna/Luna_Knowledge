import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function clearDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir)) {
    await rm(join(dir, entry), { recursive: true, force: true });
  }
}
