import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { BlobRef, BlobStorage, PutOptions } from './blob-storage.js';

/** Lưu trên một bucket S3/MinIO. File lớn (video tới 10 GB) được tự chia multipart. */
export class S3BlobStorage implements BlobStorage {
  readonly provider = 'S3' as const;

  constructor(
    private readonly client: S3Client,
    readonly bucket: string,
  ) {}

  async putFile(key: string, localPath: string, opts: PutOptions): Promise<BlobRef> {
    const { size } = await stat(localPath);
    await new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentType: opts.contentType,
        ContentLength: size,
      },
      partSize: 16 * 1024 * 1024,
      queueSize: 4,
    }).done();
    return { provider: 'S3', container: this.bucket, key };
  }

  async getStream(ref: BlobRef) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: ref.container, Key: ref.key }),
    );
    return { body: res.Body as Readable, size: res.ContentLength };
  }

  /** Key kết thúc bằng "/" là một thư mục (bản HLS): xoá mọi object bên dưới. */
  async delete(ref: BlobRef): Promise<void> {
    if (!ref.key.endsWith('/')) {
      await this.client.send(new DeleteObjectCommand({ Bucket: ref.container, Key: ref.key }));
      return;
    }
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: ref.container,
          Prefix: ref.key,
          ContinuationToken: token,
        }),
      );
      const objects = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objects.length) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: ref.container,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
