/**
 * Danh mục loại file được phép tải lên (SPEC FILE-1..3). Đuôi file chỉ dùng để chặn sớm ở API;
 * worker xác định loại thật bằng nội dung (magic bytes) và từ chối khi không khớp danh mục.
 * Không nhận HTML/SVG (chạy được script khi mở trực tiếp) và file thực thi.
 */
export type FileCategory = 'pdf' | 'office' | 'image' | 'text' | 'video';

export interface FileTypeRule {
  category: FileCategory;
  /** MIME chuẩn lưu vào DB và trả về khi tải. */
  mime: string;
  /** MIME mà `file-type` nhận ra từ nội dung; rỗng = định dạng chữ (không có magic bytes). */
  detected: string[];
}

const OFFICE_ZIP = (mime: string): FileTypeRule => ({ category: 'office', mime, detected: [mime] });
// .doc/.xls/.ppt đời cũ là Compound File (CFB): file-type chỉ nhận ra "x-cfb".
const OFFICE_CFB = (mime: string): FileTypeRule => ({
  category: 'office',
  mime,
  detected: ['application/x-cfb', mime],
});
const IMAGE = (mime: string): FileTypeRule => ({ category: 'image', mime, detected: [mime] });
const TEXT = (mime: string): FileTypeRule => ({ category: 'text', mime, detected: [] });
const VIDEO = (mime: string, ...also: string[]): FileTypeRule => ({
  category: 'video',
  mime,
  detected: [mime, ...also],
});

export const FILE_TYPES: Record<string, FileTypeRule> = {
  pdf: { category: 'pdf', mime: 'application/pdf', detected: ['application/pdf'] },
  docx: OFFICE_ZIP('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  xlsx: OFFICE_ZIP('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  pptx: OFFICE_ZIP('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  doc: OFFICE_CFB('application/msword'),
  xls: OFFICE_CFB('application/vnd.ms-excel'),
  ppt: OFFICE_CFB('application/vnd.ms-powerpoint'),
  odt: OFFICE_ZIP('application/vnd.oasis.opendocument.text'),
  ods: OFFICE_ZIP('application/vnd.oasis.opendocument.spreadsheet'),
  odp: OFFICE_ZIP('application/vnd.oasis.opendocument.presentation'),
  rtf: { category: 'office', mime: 'application/rtf', detected: ['application/rtf'] },
  png: IMAGE('image/png'),
  jpg: IMAGE('image/jpeg'),
  jpeg: IMAGE('image/jpeg'),
  webp: IMAGE('image/webp'),
  gif: IMAGE('image/gif'),
  avif: IMAGE('image/avif'),
  heic: { category: 'image', mime: 'image/heic', detected: ['image/heic', 'image/heif'] },
  txt: TEXT('text/plain'),
  md: TEXT('text/markdown'),
  csv: TEXT('text/csv'),
  json: TEXT('application/json'),
  log: TEXT('text/plain'),
  mp4: VIDEO('video/mp4', 'video/x-m4v'),
  m4v: VIDEO('video/x-m4v', 'video/mp4'),
  mov: VIDEO('video/quicktime'),
  webm: VIDEO('video/webm'),
  mkv: VIDEO('video/x-matroska'),
};

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export function ruleForFileName(fileName: string): FileTypeRule | undefined {
  return FILE_TYPES[fileExtension(fileName)];
}

export const ALLOWED_EXTENSIONS = Object.keys(FILE_TYPES);
