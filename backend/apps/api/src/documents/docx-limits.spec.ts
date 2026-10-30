import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DOCX_MAX_ENTRIES, DOCX_UNZIPPED_MAX_BYTES, measureUnzippedBytes } from './docx-limits.js';

const build = (files: Record<string, Buffer>) => {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const eocdOf = (buf: Buffer) => buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const measure = (buf: Buffer) => measureUnzippedBytes(buf, DOCX_UNZIPPED_MAX_BYTES);

const aliasEntries = (buf: Buffer, copies: number) => {
  const eocd = eocdOf(buf);
  const cd = buf.readUInt32LE(eocd + 16);
  const record = buf.subarray(cd, eocd);
  const directory = Buffer.concat(Array.from({ length: copies }, () => record));
  const tail = Buffer.from(buf.subarray(eocd));
  tail.writeUInt16LE(Math.min(copies, 0xffff), 8);
  tail.writeUInt16LE(Math.min(copies, 0xffff), 10);
  tail.writeUInt32LE(directory.length, 12);
  tail.writeUInt32LE(cd, 16);
  return Buffer.concat([buf.subarray(0, cd), directory, tail]);
};

const emptyBlockZip = (dataBytes: number) => {
  const block = Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff]);
  const blocks = Math.max(1, Math.floor(dataBytes / block.length));
  const data = Buffer.concat([
    ...Array.from({ length: blocks - 1 }, () => block),
    Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff]),
  ]);
  const name = Buffer.from('a.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(name.length, 28);
  const cd = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(cd, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
};

const timed = (buf: Buffer) => {
  const started = performance.now();
  const result = measure(buf);
  return { result, ms: performance.now() - started };
};

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

  it('dữ liệu toàn khối rỗng nở ra 0 byte vẫn đo được', () => {
    expect(measure(emptyBlockZip(1000))).toBe(0);
  });

  it('nhiều mục cùng trỏ vào một luồng khối rỗng thì trả Infinity ngay', () => {
    const buf = aliasEntries(emptyBlockZip(1024 * 1024), 2000);
    expect(buf.length).toBeLessThan(2 * 1024 * 1024);
    const { result, ms } = timed(buf);
    expect(result).toBe(Number.POSITIVE_INFINITY);
    expect(ms).toBeLessThan(200);
  });

  it('vài mục trỏ chung một dữ liệu nhỏ thì trả null vì các mục chồng lên nhau', async () => {
    const buf = aliasEntries(await build({ 'a.xml': Buffer.alloc(1000, 1) }), 3);
    const { result, ms } = timed(buf);
    expect(result).toBeNull();
    expect(ms).toBeLessThan(200);
  });

  it('quá nhiều mục thì trả Infinity ngay', async () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < DOCX_MAX_ENTRIES + 1; i++) files[`f${i}.xml`] = Buffer.from('x');
    const { result, ms } = timed(await build(files));
    expect(result).toBe(Number.POSITIVE_INFINITY);
    expect(ms).toBeLessThan(200);
  });

  it('docx bình thường với vài trăm mục vẫn đo đúng', async () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 300; i++) files[`word/part${i}.xml`] = Buffer.alloc(100 + i, i % 256);
    const expected = Object.values(files).reduce((sum, b) => sum + b.length, 0);
    expect(measure(await build(files))).toBe(expected);
  });
});
