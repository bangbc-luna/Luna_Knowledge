import type { Readable } from 'node:stream';

export type StorageProviderName = 'S3' | 'GDRIVE';

export interface BlobRef {
  provider: StorageProviderName;
  container: string;
  key: string;
}

export interface PutOptions {
  contentType: string;
  fileName?: string;
}

export interface BlobStorage {
  readonly provider: StorageProviderName;
  putFile(key: string, localPath: string, opts: PutOptions): Promise<BlobRef>;
  getStream(ref: BlobRef): Promise<{ body: Readable; size?: number }>;
  delete(ref: BlobRef): Promise<void>;
}
