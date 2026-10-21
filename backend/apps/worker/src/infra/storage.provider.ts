import type { S3Client } from '@aws-sdk/client-s3';
import {
  type BlobRef,
  type BlobStorage,
  bucketNames,
  type BucketKey,
  createS3Client,
  S3BlobStorage,
} from '@luna/shared';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { WORKER_CONFIG, type WorkerConfig } from '../config/worker-config.js';

@Injectable()
export class StorageService implements OnModuleDestroy {
  readonly s3: S3Client;
  readonly buckets: Record<BucketKey, string>;
  readonly originals: BlobStorage;
  private readonly s3Storage: S3BlobStorage;

  constructor(@Inject(WORKER_CONFIG) config: WorkerConfig) {
    this.s3 = createS3Client(config);
    this.buckets = bucketNames(config);
    this.s3Storage = new S3BlobStorage(this.s3, this.buckets.originals);
    this.originals = this.s3Storage;
  }

  bucket(key: BucketKey): S3BlobStorage {
    return new S3BlobStorage(this.s3, this.buckets[key]);
  }

  forRef(ref: Pick<BlobRef, 'provider'>): BlobStorage {
    if (ref.provider === 'S3') return this.s3Storage;
    throw new Error(`Unsupported storage provider ${ref.provider}`);
  }

  onModuleDestroy() {
    this.s3.destroy();
  }
}
