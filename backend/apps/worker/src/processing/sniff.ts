import { open } from 'node:fs/promises';
import { FILE_TYPES, type FileTypeRule, ruleForFileName } from '@luna/shared';
import { fileTypeFromFile } from 'file-type';

/** File không hợp lệ: lỗi vĩnh viễn, không thử lại. */
export class RejectedFileError extends Error {
  override readonly name = 'RejectedFileError';
}

const TEXT_PROBE_BYTES = 64 * 1024;

/**
 * Xác định loại file bằng nội dung (magic bytes), không tin đuôi file hay MIME trình duyệt báo.
 * - Định dạng nhị phân: loại nhận ra phải nằm trong danh mục (ưu tiên luật của đuôi file).
 * - Định dạng chữ: không có magic bytes → phải là UTF-8 hợp lệ, không có byte NUL.
 * `.exe` đổi tên thành `.pdf` bị nhận ra là `application/x-msdownload` → từ chối.
 */
export async function sniffFile(
  localPath: string,
  fileName: string,
  kind: 'FILE' | 'VIDEO',
): Promise<FileTypeRule> {
  const byName = ruleForFileName(fileName);
  if (!byName) throw new RejectedFileError('This file type is not allowed');

  const detected = await fileTypeFromFile(localPath);
  let rule: FileTypeRule | undefined;
  if (!detected) {
    if (byName.category !== 'text' || !(await looksLikeUtf8Text(localPath))) {
      throw new RejectedFileError('File content does not match its extension');
    }
    rule = byName;
  } else if (byName.detected.includes(detected.mime)) {
    rule = byName;
  } else {
    // Ví dụ .docx bị đặt đuôi .doc: vẫn nhận nếu loại thật được phép (trừ CFB mơ hồ).
    rule = Object.values(FILE_TYPES).find(
      (r) => r.mime === detected.mime && r.detected.includes(detected.mime),
    );
    if (!rule) {
      throw new RejectedFileError(`File content (${detected.mime}) is not an allowed type`);
    }
  }

  if ((rule.category === 'video') !== (kind === 'VIDEO')) {
    throw new RejectedFileError(
      kind === 'VIDEO' ? 'File is not a video' : 'Video files must be uploaded as videos',
    );
  }
  return rule;
}

async function looksLikeUtf8Text(localPath: string): Promise<boolean> {
  const fh = await open(localPath, 'r');
  try {
    const buf = Buffer.alloc(TEXT_PROBE_BYTES);
    const { bytesRead } = await fh.read(buf, 0, TEXT_PROBE_BYTES, 0);
    const chunk = buf.subarray(0, bytesRead);
    if (chunk.includes(0)) return false;
    // Cắt đoạn đầu có thể rơi giữa một ký tự nhiều byte: bỏ tối đa 3 byte cuối rồi kiểm tra.
    for (let cut = 0; cut <= Math.min(3, chunk.length); cut++) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(chunk.subarray(0, chunk.length - cut));
        return true;
      } catch {
        if (bytesRead < TEXT_PROBE_BYTES) return false;
      }
    }
    return false;
  } finally {
    await fh.close();
  }
}
