import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type BlobRef, type BlobStorage, S3BlobStorage } from '@luna/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error.js';
import { BUCKETS, type Buckets, S3, S3_PRESIGN } from '../infra/s3/s3.module.js';

export const PREVIEW_URL_TTL_SEC = 600;

export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@Injectable()
export class StorageService {
  private readonly s3Storage: S3BlobStorage;

  constructor(
    @Inject(S3) s3: S3Client,
    @Inject(S3_PRESIGN) private readonly presignClient: S3Client,
    @Inject(BUCKETS) readonly buckets: Buckets,
  ) {
    this.s3Storage = new S3BlobStorage(s3, buckets.originals);
  }

  forRef(ref: Pick<BlobRef, 'provider'>): BlobStorage {
    if (ref.provider === 'S3') return this.s3Storage;
    throw AppError.unavailable(`Unsupported storage provider ${ref.provider}`);
  }

  async presignGet(
    ref: BlobRef,
    opts: { fileName: string; contentType: string; disposition?: 'inline' | 'attachment' },
  ): Promise<{ url: string; expiresAt: Date }> {
    if (ref.provider !== 'S3') throw AppError.unavailable('Only S3 objects can be presigned');
    const url = await getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: ref.container,
        Key: ref.key,
        ResponseContentType: opts.contentType,
        ResponseContentDisposition: contentDisposition(opts.disposition ?? 'inline', opts.fileName),
        ResponseCacheControl: 'private, max-age=600',
      }),
      { expiresIn: PREVIEW_URL_TTL_SEC },
    );
    return { url, expiresAt: new Date(Date.now() + PREVIEW_URL_TTL_SEC * 1000) };
  }
}
