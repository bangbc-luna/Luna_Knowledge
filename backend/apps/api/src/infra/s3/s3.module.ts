import type { S3Client } from '@aws-sdk/client-s3';
import { bucketNames, createPresignClient, createS3Client, type BucketKey } from '@luna/shared';
import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

export const S3 = Symbol('S3');
/** Client ký URL cho trình duyệt (host = S3_PUBLIC_ENDPOINT). Không dùng để gọi S3 từ server. */
export const S3_PRESIGN = Symbol('S3_PRESIGN');
export const BUCKETS = Symbol('BUCKETS');
export type Buckets = Record<BucketKey, string>;

@Global()
@Module({
  providers: [
    { provide: S3, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createS3Client(c) },
    {
      provide: S3_PRESIGN,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => createPresignClient(c),
    },
    { provide: BUCKETS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => bucketNames(c) },
  ],
  exports: [S3, S3_PRESIGN, BUCKETS],
})
export class S3Module implements OnModuleDestroy {
  constructor(
    @Inject(S3) private readonly s3: S3Client,
    @Inject(S3_PRESIGN) private readonly presign: S3Client,
  ) {}

  onModuleDestroy() {
    this.s3.destroy();
    this.presign.destroy();
  }
}
