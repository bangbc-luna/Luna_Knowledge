import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { z } from 'zod';
import type { BucketKey } from './constants.js';
import type { s3EnvSchema } from './env.js';

export type S3Env = z.output<typeof s3EnvSchema>;

export function createS3Client(env: S3Env): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
}

export function createPresignClient(env: S3Env): S3Client {
  return createS3Client({ ...env, S3_ENDPOINT: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
}

export function bucketNames(env: S3Env): Record<BucketKey, string> {
  return {
    tmp: env.S3_BUCKET_TMP,
    hls: env.S3_BUCKET_HLS,
    previews: env.S3_BUCKET_PREVIEWS,
    thumbnails: env.S3_BUCKET_THUMBNAILS,
    assets: env.S3_BUCKET_ASSETS,
    originals: env.S3_BUCKET_ORIGINALS,
  };
}

async function bucketExists(client: S3Client, bucket: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw err;
  }
}

export async function ensureBuckets(client: S3Client, env: S3Env): Promise<string[]> {
  const created: string[] = [];
  for (const bucket of Object.values(bucketNames(env))) {
    if (!(await bucketExists(client, bucket))) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      created.push(bucket);
    }
  }
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: env.S3_BUCKET_TMP,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'expire-tmp',
            Status: 'Enabled',
            Filter: { Prefix: '' },
            Expiration: { Days: 2 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
          },
        ],
      },
    }),
  );
  return created;
}
