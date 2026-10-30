import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DOCX_UNZIPPED_MAX_BYTES, measureUnzippedBytes } from './docx-limits.js';

const build = (files: Record<string, Buffer>) => {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const eocdOf = (buf: Buffer) => buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const measure = (buf: Buffer) => measureUnzippedBytes(buf, DOCX_UNZIPPED_MAX_BYTES);

describe('measureUnzippedBytes', () => {
  it('cộng dung lượng giải nén của mọi mục', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(1000, 1), 'b.xml': Buffer.alloc(2500, 2) });
    expect(measure(buf)).toBe(3500);
  });

  it('file nén nhỏ nhưng nở lớn vẫn đo đúng', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(5 * 1024 * 1024) });
    expect(measure(buf)).toBe(5 * 1024 * 1024);
    expect(buf.length).toBeLessThan(100_000);
  });

  it('không phải zip thì trả null', () => {
    expect(measure(Buffer.from('not a zip'))).toBeNull();
  });

  it('ZIP64 coi như vô hạn', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(1000, 1) });
    const cd = buf.readUInt32LE(eocdOf(buf) + 16);
    buf.writeUInt32LE(0xffffffff, cd + 24);
    expect(measure(buf)).toBe(Number.POSITIVE_INFINITY);
  });

  it('khai báo kích thước nhỏ nhưng dữ liệu thật nở vượt giới hạn thì trả Infinity', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(5 * 1024 * 1024) });
    const cd = buf.readUInt32LE(eocdOf(buf) + 16);
    buf.writeUInt32LE(10, cd + 24);
    expect(measureUnzippedBytes(buf, 1024 * 1024)).toBe(Number.POSITIVE_INFINITY);
  });

  it('EOCD khai báo ít mục hơn thực tế vẫn đếm đủ mọi mục', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(1000, 1), 'b.xml': Buffer.alloc(2500, 2) });
    buf.writeUInt16LE(1, eocdOf(buf) + 10);
    expect(measure(buf)).toBe(3500);
  });

  it('thư mục trung tâm bị cắt hoặc offset vượt cuối buffer thì trả null', async () => {
    const buf = await build({ 'a.xml': Buffer.alloc(1000, 1) });
    const bad = Buffer.from(buf);
    bad.writeUInt32LE(buf.length + 100, eocdOf(bad) + 16);
    expect(measure(bad)).toBeNull();
    const cd = buf.readUInt32LE(eocdOf(buf) + 16);
    const cut = Buffer.concat([buf.subarray(0, cd + 20), buf.subarray(eocdOf(buf))]);
    expect(measure(cut)).toBeNull();
  });
});
