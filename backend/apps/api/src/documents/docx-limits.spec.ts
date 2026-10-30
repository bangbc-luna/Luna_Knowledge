import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { zipUncompressedBytes } from './docx-limits.js';

const build = (files: Record<string, Buffer>) => {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

describe('zipUncompressedBytes', () => {
  it('cộng dung lượng giải nén của mọi mục', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(1000, 1), 'b.xml': Buffer.alloc(2500, 2) });
    expect(zipUncompressedBytes(buf)).toBe(3500);
  });

  it('file nén nhỏ nhưng nở lớn vẫn đo đúng', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(5 * 1024 * 1024) });
    expect(zipUncompressedBytes(buf)).toBe(5 * 1024 * 1024);
    expect(buf.length).toBeLessThan(100_000);
  });

  it('không phải zip thì trả null', () => {
    expect(zipUncompressedBytes(Buffer.from('not a zip'))).toBeNull();
  });

  it('ZIP64 coi như vô hạn', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(1000, 1) });
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cd = buf.readUInt32LE(eocd + 16);
    buf.writeUInt32LE(0xffffffff, cd + 24);
    expect(zipUncompressedBytes(buf)).toBe(Number.POSITIVE_INFINITY);
  });
});
