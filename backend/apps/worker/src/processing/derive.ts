import { openAsBlob } from 'node:fs';
import { open, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileTypeRule } from '@luna/shared';
import sharp from 'sharp';

const PREVIEW_PX = 1600;
const THUMB_PX = 320;
/** Giới hạn chữ trích để lưu DB/đánh chỉ mục (Phase 6). */
export const MAX_TEXT_CHARS = 1_000_000;
const CONVERT_TIMEOUT_MS = 180_000;
/** File chữ lớn hơn mức này không có bản xem trước (trình duyệt cũng không hiển thị nổi). */
const MAX_TEXT_PREVIEW_BYTES = 5 * 1024 * 1024;

export interface DerivedFile {
  path: string;
  mime: string;
  ext: string;
}

export interface Derived {
  previewKind: 'pdf' | 'image' | 'text' | 'none';
  preview?: DerivedFile;
  thumbnail?: DerivedFile;
  /** Lỗi không chặn (không tạo được preview…), ghi lại để hiển thị. */
  warnings: string[];
}

export interface Converters {
  gotenbergUrl: string;
  tikaUrl: string;
}

/** Tạo bản xem trước theo loại file (SPEC FILE-1..3). Lỗi tạo preview không làm hỏng việc upload. */
export async function buildPreviews(
  localPath: string,
  fileName: string,
  rule: FileTypeRule,
  workDir: string,
  conv: Converters,
): Promise<Derived> {
  const warnings: string[] = [];
  try {
    switch (rule.category) {
      case 'pdf':
        return {
          previewKind: 'pdf',
          preview: { path: localPath, mime: 'application/pdf', ext: 'pdf' },
          warnings,
        };
      case 'text':
        if ((await stat(localPath)).size > MAX_TEXT_PREVIEW_BYTES) {
          return { previewKind: 'none', warnings };
        }
        return {
          previewKind: 'text',
          preview: { path: localPath, mime: `${textMime(rule.mime)}; charset=utf-8`, ext: 'txt' },
          warnings,
        };
      case 'office': {
        const pdf = join(workDir, 'preview.pdf');
        await officeToPdf(localPath, fileName, pdf, conv.gotenbergUrl);
        return {
          previewKind: 'pdf',
          preview: { path: pdf, mime: 'application/pdf', ext: 'pdf' },
          warnings,
        };
      }
      case 'image': {
        const preview = join(workDir, 'preview.webp');
        const thumb = join(workDir, 'thumb.webp');
        // rotate(): xoay theo EXIF (ảnh chụp điện thoại). Bỏ metadata (GPS…) ở bản dẫn xuất.
        await sharp(localPath)
          .rotate()
          .resize(PREVIEW_PX, PREVIEW_PX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(preview);
        await sharp(localPath)
          .rotate()
          .resize(THUMB_PX, THUMB_PX, { fit: 'cover' })
          .webp({ quality: 75 })
          .toFile(thumb);
        return {
          previewKind: 'image',
          preview: { path: preview, mime: 'image/webp', ext: 'webp' },
          thumbnail: { path: thumb, mime: 'image/webp', ext: 'webp' },
          warnings,
        };
      }
      case 'video':
        // Phase 4: transcode HLS, poster, sprite.
        return { previewKind: 'none', warnings };
    }
  } catch (err) {
    warnings.push(`Preview failed: ${(err as Error).message}`);
  }
  return { previewKind: 'none', warnings };
}

/** text/csv, text/markdown hiển thị như chữ thường; JSON giữ MIME riêng. */
function textMime(mime: string): string {
  return mime === 'application/json' ? 'application/json' : 'text/plain';
}

async function officeToPdf(src: string, fileName: string, out: string, gotenbergUrl: string) {
  const form = new FormData();
  // Gotenberg đoán định dạng theo đuôi file trong tên.
  form.append('files', await openAsBlob(src), safeAsciiName(fileName));
  const res = await fetch(new URL('/forms/libreoffice/convert', gotenbergUrl), {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Gotenberg ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}

/** Trích chữ để tìm kiếm: định dạng chữ đọc thẳng, còn lại qua Tika. Ảnh/video bỏ qua. */
export async function extractText(
  localPath: string,
  rule: FileTypeRule,
  tikaUrl: string,
): Promise<string | null> {
  if (rule.category === 'image' || rule.category === 'video') return null;
  if (rule.category === 'text') {
    const fh = await open(localPath, 'r');
    try {
      const buf = Buffer.alloc(MAX_TEXT_CHARS * 2);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return clean(buf.subarray(0, bytesRead).toString('utf8'));
    } finally {
      await fh.close();
    }
  }
  const res = await fetch(new URL('/tika', tikaUrl), {
    method: 'PUT',
    headers: { Accept: 'text/plain; charset=utf-8', 'Content-Type': rule.mime },
    body: await openAsBlob(localPath),
    signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tika ${res.status}`);
  return clean(await res.text());
}

function clean(text: string): string | null {
  const t = text
    .replaceAll('\u0000', '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t ? t.slice(0, MAX_TEXT_CHARS) : null;
}

function safeAsciiName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
  return `document${ext}`;
}
