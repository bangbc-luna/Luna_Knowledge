import { z } from 'zod';

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

/**
 * Phân trang theo id (UUIDv7 tăng dần theo thời gian tạo).
 * Truy vấn lấy `limit + 1` bản ghi; có bản ghi thừa nghĩa là còn trang sau.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}
