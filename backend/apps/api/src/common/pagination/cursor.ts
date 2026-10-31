import { z } from 'zod';
import { AppError } from '../errors/app-error.js';

export const paginationQuery = z.object({
  cursor: z.string().optional().describe('Giá trị nextCursor của trang trước'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export function encodeKeysetCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

export function decodeKeysetCursor(cursor: string): { at: Date; id: string } {
  const [iso, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (rest.length > 0 || !id || Number.isNaN(at.getTime()) || !z.uuid().safeParse(id).success) {
    throw AppError.validation('Invalid cursor');
  }
  return { at, id };
}
