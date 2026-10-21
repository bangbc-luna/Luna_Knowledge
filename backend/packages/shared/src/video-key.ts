import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function sealVideoKey(key: Buffer, masterKeyBase64: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(masterKeyBase64, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(key), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function openVideoKey(sealed: Uint8Array, masterKeyBase64: string): Buffer {
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(masterKeyBase64, 'base64'),
    buf.subarray(0, 12),
  );
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}
