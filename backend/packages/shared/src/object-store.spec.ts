import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { contentDisposition, ObjectStore } from './object-store.js';
import type { S3Env } from './s3.js';

const env = {
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://media.test',
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: true,
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  S3_BUCKET_TMP: 'tmp',
  S3_BUCKET_HLS: 'hls',
  S3_BUCKET_PREVIEWS: 'pv',
  S3_BUCKET_THUMBNAILS: 'th',
  S3_BUCKET_ASSETS: 'as',
  S3_BUCKET_ORIGINALS: 'or',
} as S3Env;

describe('ObjectStore', () => {
  it('presignGet ký bằng endpoint công khai, kèm disposition hai dạng và cache 600 giây', async () => {
    const store = new ObjectStore(env, { s3: { send: vi.fn() } as never });
    const { url, expiresAt } = await store.presignGet(
      { container: 'pv', key: 'a/b' },
      {
        expiresInSec: 600,
        contentType: 'application/pdf',
        disposition: { type: 'attachment', fileName: 'Báo cáo.pdf' },
        cacheControl: 'private, max-age=600',
      },
    );
    expect(url.startsWith('http://media.test/pv/a/b?')).toBe(true);
    expect(url).toContain('X-Amz-Expires=600');
    expect(decodeURIComponent(url)).toContain(
      `attachment; filename="Bao cao.pdf"; filename*=UTF-8''B%C3%A1o%20c%C3%A1o.pdf`,
    );
    expect(Math.abs(expiresAt.getTime() - Date.now() - 600_000)).toBeLessThan(2000);

    const raw = await store.presignGet(
      { container: 'hls', key: 'v/seg.ts' },
      { expiresInSec: 120, disposition: 'inline', cacheControl: 'private, max-age=60' },
    );
    expect(raw.url).toContain('X-Amz-Expires=120');
    expect(raw.url).toContain('response-content-disposition=inline&');
  });

  it('delete key thường gửi đúng một DeleteObjectCommand', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new ObjectStore(env, { s3: { send } as never });
    await store.delete({ container: 'or', key: 'x' });
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]![0];
    expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    expect(cmd.input).toEqual({ Bucket: 'or', Key: 'x' });
  });

  it('delete prefix xoá theo trang cho tới khi hết', async () => {
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        return cmd.input.ContinuationToken
          ? { Contents: [{ Key: 'p/3' }], IsTruncated: false }
          : {
              Contents: [{ Key: 'p/1' }, { Key: 'p/2' }],
              IsTruncated: true,
              NextContinuationToken: 't1',
            };
      }
      return {};
    });
    const store = new ObjectStore(env, { s3: { send } as never });
    await store.delete({ container: 'hls', key: 'p/' });
    const deletes = send.mock.calls
      .map(([c]) => c)
      .filter((c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand);
    expect(deletes).toHaveLength(2);
    expect(deletes[0]!.input).toEqual({
      Bucket: 'hls',
      Delete: { Objects: [{ Key: 'p/1' }, { Key: 'p/2' }], Quiet: true },
    });
    expect(deletes[1]!.input).toEqual({
      Bucket: 'hls',
      Delete: { Objects: [{ Key: 'p/3' }], Quiet: true },
    });
  });

  it('copy dùng CopySource container/key và trả provider S3', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new ObjectStore(env, { s3: { send } as never });
    const result = await store.copy({ container: 'or', key: 'src/1' }, 'assets', 'docs/n/1');
    expect(result).toEqual({ provider: 'S3', container: 'as', key: 'docs/n/1' });
    const cmd = send.mock.calls[0]![0];
    expect(cmd).toBeInstanceOf(CopyObjectCommand);
    expect(cmd.input).toEqual({ Bucket: 'as', Key: 'docs/n/1', CopySource: 'or/src/1' });
  });

  it('từ chối blob của provider khác S3', async () => {
    const send = vi.fn();
    const store = new ObjectStore(env, { s3: { send } as never });
    const ref = { provider: 'GDRIVE', container: 'or', key: 'x' };
    await expect(store.getStream(ref)).rejects.toThrow('Unsupported storage provider GDRIVE');
    await expect(store.delete(ref)).rejects.toThrow('Unsupported storage provider GDRIVE');
    expect(send).not.toHaveBeenCalled();
  });

  it('contentDisposition bỏ dấu và ký tự cấm cho filename ASCII', () => {
    expect(contentDisposition('attachment', 'Đơn "x".pdf')).toBe(
      `attachment; filename="Don _x_.pdf"; filename*=UTF-8''${encodeURIComponent('Đơn "x".pdf')}`,
    );
  });

  it('presignUploadPart ký part bằng endpoint công khai với bucket tmp và hạn 3600 giây', async () => {
    const store = new ObjectStore(env, { s3: { send: vi.fn() } as never });
    const url = await store.presignUploadPart({ container: 'tmp', key: 'u/1' }, 'up-1', 3, 3600);
    expect(url.startsWith('http://media.test/tmp/u/1?')).toBe(true);
    expect(url).toContain('X-Amz-Expires=3600');
    expect(url).toContain('partNumber=3');
    expect(url).toContain('uploadId=up-1');
  });
});
