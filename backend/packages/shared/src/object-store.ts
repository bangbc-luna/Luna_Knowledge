import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { BucketKey } from './constants.js';
import { bucketNames, createPresignClient, createS3Client, type S3Env } from './s3.js';

export interface ObjectRef {
  provider?: string;
  container: string;
  key: string;
}

export interface StoredObject extends ObjectRef {
  provider: 'S3';
}

export interface PresignGetOptions {
  expiresInSec: number;
  contentType?: string;
  disposition?: 'inline' | { type: 'inline' | 'attachment'; fileName: string };
  cacheControl?: string;
}

export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function s3Ref(ref: ObjectRef): ObjectRef {
  if (ref.provider !== undefined && ref.provider !== 'S3') {
    throw new Error(`Unsupported storage provider ${ref.provider}`);
  }
  return ref;
}

export class ObjectStore {
  readonly s3: S3Client;
  readonly buckets: Record<BucketKey, string>;
  private readonly presigner: S3Client;

  constructor(env: S3Env, clients: { s3?: S3Client; presigner?: S3Client } = {}) {
    this.s3 = clients.s3 ?? createS3Client(env);
    this.presigner = clients.presigner ?? createPresignClient(env);
    this.buckets = bucketNames(env);
  }

  async putFile(
    bucket: BucketKey,
    key: string,
    localPath: string,
    contentType: string,
  ): Promise<StoredObject> {
    const container = this.buckets[bucket];
    const { size } = await stat(localPath);
    await new Upload({
      client: this.s3,
      params: {
        Bucket: container,
        Key: key,
        Body: createReadStream(localPath),
        ContentType: contentType,
        ContentLength: size,
      },
      partSize: 16 * 1024 * 1024,
      queueSize: 4,
    }).done();
    return { provider: 'S3', container, key };
  }

  async putBuffer(
    bucket: BucketKey,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    const container = this.buckets[bucket];
    await this.s3.send(
      new PutObjectCommand({ Bucket: container, Key: key, Body: body, ContentType: contentType }),
    );
    return { provider: 'S3', container, key };
  }

  async copy(from: ObjectRef, bucket: BucketKey, key: string): Promise<StoredObject> {
    const src = s3Ref(from);
    const container = this.buckets[bucket];
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: container,
        Key: key,
        CopySource: `${src.container}/${src.key}`,
      }),
    );
    return { provider: 'S3', container, key };
  }

  async getStream(ref: ObjectRef): Promise<{ body: Readable; size?: number }> {
    const { container, key } = s3Ref(ref);
    const res = await this.s3.send(new GetObjectCommand({ Bucket: container, Key: key }));
    return { body: res.Body as Readable, size: res.ContentLength };
  }

  async delete(ref: ObjectRef): Promise<void> {
    const { container, key } = s3Ref(ref);
    if (!key.endsWith('/')) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: container, Key: key }));
      return;
    }
    let token: string | undefined;
    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({ Bucket: container, Prefix: key, ContinuationToken: token }),
      );
      const objects = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objects.length) {
        await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: container,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async presignGet(
    ref: ObjectRef,
    opts: PresignGetOptions,
  ): Promise<{ url: string; expiresAt: Date }> {
    const { container, key } = s3Ref(ref);
    const disposition =
      typeof opts.disposition === 'object'
        ? contentDisposition(opts.disposition.type, opts.disposition.fileName)
        : opts.disposition;
    const url = await getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: container,
        Key: key,
        ResponseContentType: opts.contentType,
        ResponseContentDisposition: disposition,
        ResponseCacheControl: opts.cacheControl,
      }),
      { expiresIn: opts.expiresInSec },
    );
    return { url, expiresAt: new Date(Date.now() + opts.expiresInSec * 1000) };
  }

  presignUploadPart(
    ref: ObjectRef,
    uploadId: string,
    partNumber: number,
    expiresInSec: number,
  ): Promise<string> {
    const { container, key } = s3Ref(ref);
    return getSignedUrl(
      this.presigner,
      new UploadPartCommand({
        Bucket: container,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: expiresInSec },
    );
  }

  destroy(): void {
    this.s3.destroy();
    this.presigner.destroy();
  }
}
