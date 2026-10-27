import { z } from 'zod';

export function normalizeName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase('vi');
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f/\\]/;

export const nodeNameSchema = z
  .string()
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, 'Name is required')
      .max(255)
      .refine((v) => !FORBIDDEN.test(v), 'Name must not contain / \\ or control characters')
      .refine((v) => v !== '.' && v !== '..', 'Invalid name'),
  );

export const NODE_TITLE_MAX = 200;
export const NODE_DESCRIPTION_MAX = 5000;

export const nodeTitleSchema = nodeNameSchema.pipe(z.string().max(NODE_TITLE_MAX));

export const nodeDescriptionSchema = z
  .string()
  .transform((v) => v.normalize('NFC').trim())
  .pipe(z.string().min(1, 'Description is required').max(NODE_DESCRIPTION_MAX));

export function suggestName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  const stem = base.replace(/ \(\d+\)$/, '');
  for (let i = 1; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}
