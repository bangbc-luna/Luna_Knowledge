/** Đuôi file được phép tải lên (khớp backend `FILE_TYPES`). Dùng cho `accept` và để chặn sớm. */
export const ALLOWED_EXTENSIONS = [
  "pdf", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "odt", "ods", "odp", "rtf",
  "png", "jpg", "jpeg", "webp", "gif", "avif", "heic",
  "txt", "md", "csv", "json", "log",
  "mp4", "m4v", "mov", "webm", "mkv",
];
export const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv"];
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");
export const MAX_FILE_MB = 500;
export const MAX_VIDEO_MB = 10_240;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** "6,8 MB", "512 KB", "1,1 GB" (dấu phẩy thập phân như mọi số trong app). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 100 ? 0 : 1;
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: digits })} ${units[unit]}`;
}

export type FileKind = "pdf" | "word" | "sheet" | "slide" | "image" | "text" | "video" | "other";

const MIME_KIND: Array<[RegExp, FileKind]> = [
  [/^application\/pdf$/, "pdf"],
  [/wordprocessingml|msword|opendocument\.text|rtf/, "word"],
  [/spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv/, "sheet"],
  [/presentationml|ms-powerpoint|opendocument\.presentation/, "slide"],
  [/^image\//, "image"],
  [/^video\//, "video"],
  [/^text\/|application\/json/, "text"],
];
const EXT_KIND: Record<string, FileKind> = {
  pdf: "pdf", doc: "word", docx: "word", odt: "word", rtf: "word",
  xls: "sheet", xlsx: "sheet", ods: "sheet", csv: "sheet",
  ppt: "slide", pptx: "slide", odp: "slide",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", avif: "image", heic: "image",
  txt: "text", md: "text", json: "text", log: "text",
  mp4: "video", m4v: "video", mov: "video", webm: "video", mkv: "video",
};

export function fileKind(name: string, mime?: string | null): FileKind {
  if (mime) for (const [re, k] of MIME_KIND) if (re.test(mime)) return k;
  return EXT_KIND[extensionOf(name)] ?? "other";
}

const KIND_LABEL: Record<FileKind, string> = {
  pdf: "PDF",
  word: "Word",
  sheet: "Bảng tính",
  slide: "Trình chiếu",
  image: "Ảnh",
  text: "Văn bản",
  video: "Video",
  other: "Tệp",
};

export function fileKindLabel(name: string, mime?: string | null): string {
  return KIND_LABEL[fileKind(name, mime)];
}
