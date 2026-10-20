// Khởi tạo hạ tầng lưu trữ sau khi `pnpm infra:up`: tạo bucket S3 và đặt lifecycle cho bucket tmp.
// Chạy lại nhiều lần vẫn an toàn.
import { createS3Client, ensureBuckets, loadEnv, s3EnvSchema } from '@luna/shared';

const env = loadEnv(s3EnvSchema);
const client = createS3Client(env);
const created = await ensureBuckets(client, env);
console.log(
  created.length ? `Created buckets: ${created.join(', ')}` : 'All buckets already exist.',
);
