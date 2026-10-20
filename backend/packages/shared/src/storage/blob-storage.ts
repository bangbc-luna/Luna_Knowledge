import type { Readable } from 'node:stream';

export type StorageProviderName = 'S3' | 'GDRIVE';

/** Vị trí một object: bucket + key. `GDRIVE` còn trong enum DB nhưng không dùng (quyết định 2026-10-20). */
export interface BlobRef {
  provider: StorageProviderName;
  container: string;
  key: string;
}

export interface PutOptions {
  contentType: string;
  /** Tên file hiển thị (kho S3 bỏ qua). */
  fileName?: string;
}

/**
 * Lớp trừu tượng nơi lưu file (SPEC §5). Hiện chỉ có S3/MinIO; đổi sang R2/AWS S3 hay thêm kho khác chỉ cần cài interface này,
 * phần còn lại của hệ thống chỉ giữ `BlobRef` trong bảng `blobs`.
 */
export interface BlobStorage {
  readonly provider: StorageProviderName;
  /** Ghi file cục bộ lên kho; trả về ref (kho tự sinh id thì key có thể khác `key` truyền vào). */
  putFile(key: string, localPath: string, opts: PutOptions): Promise<BlobRef>;
  /** Đọc dạng stream (tải về qua API, worker tạo lại preview). */
  getStream(ref: BlobRef): Promise<{ body: Readable; size?: number }>;
  /** Xoá object; không có cũng coi là thành công. */
  delete(ref: BlobRef): Promise<void>;
}
