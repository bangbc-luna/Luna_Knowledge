import { createS3Client, ensureBuckets, loadEnv, s3EnvSchema } from '@luna/shared';

const env = loadEnv(s3EnvSchema);
const client = createS3Client(env);
const created = await ensureBuckets(client, env);
console.log(
  created.length ? `Created buckets: ${created.join(', ')}` : 'All buckets already exist.',
);
