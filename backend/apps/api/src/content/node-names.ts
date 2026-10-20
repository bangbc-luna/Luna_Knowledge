import { z } from 'zod';

/** Chuẩn hóa tên hiển thị: NFC (tiếng Việt gõ tổ hợp/dựng sẵn như nhau), gộp khoảng trắng. */
export function normalizeName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Khóa so trùng tên: không phân biệt hoa thường (SPEC NODE-7). */
export function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase('vi');
}

// Ký tự điều khiển và dấu phân cách đường dẫn gây lỗi khi tải file / hiển thị breadcrumb.
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

/**
 * Gợi ý tên chưa dùng: "Báo cáo" → "Báo cáo (1)", "report.pdf" → "report (1).pdf".
 * `taken` là tập nameKey của các anh em cùng folder.
 */
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
