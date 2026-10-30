import { inflateRawSync } from 'node:zlib';

export const DOCX_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const DOCX_UNZIPPED_MAX_BYTES = 100 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
const EOCD_SEARCH_BYTES = 65_557;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const ZIP64_MARKER = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

function findEocd(buf: Buffer): number {
  if (buf.length < EOCD_MIN_BYTES) return -1;
  const lowest = Math.max(0, buf.length - EOCD_SEARCH_BYTES);
  for (let i = buf.length - EOCD_MIN_BYTES; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

export function measureUnzippedBytes(buf: Buffer, limit: number): number | null {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  const directorySize = buf.readUInt32LE(eocd + 12);
  const directoryOffset = buf.readUInt32LE(eocd + 16);
  if (directorySize === ZIP64_MARKER || directoryOffset === ZIP64_MARKER) {
    return Number.POSITIVE_INFINITY;
  }
  const prefix = Math.max(0, eocd - directorySize - directoryOffset);
  let cursor = prefix + directoryOffset;
  let entries = 0;
  let total = 0;
  while (
    cursor + CENTRAL_HEADER_BYTES <= buf.length &&
    buf.readUInt32LE(cursor) === CENTRAL_SIGNATURE
  ) {
    entries++;
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const localOffset = buf.readUInt32LE(cursor + 42);
    if (
      compressedSize === ZIP64_MARKER ||
      uncompressedSize === ZIP64_MARKER ||
      localOffset === ZIP64_MARKER
    ) {
      return Number.POSITIVE_INFINITY;
    }
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const local = prefix + localOffset;
    if (local + LOCAL_HEADER_BYTES > buf.length || buf.readUInt32LE(local) !== LOCAL_SIGNATURE) {
      return null;
    }
    const dataStart =
      local + LOCAL_HEADER_BYTES + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) return null;
    const data = buf.subarray(dataStart, dataEnd);
    if (method === METHOD_STORED) {
      total += data.length;
    } else if (method === METHOD_DEFLATE) {
      try {
        total += inflateRawSync(data, { maxOutputLength: limit - total + 1 }).length;
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
          return Number.POSITIVE_INFINITY;
        }
        return null;
      }
    } else {
      return null;
    }
    if (total > limit) return Number.POSITIVE_INFINITY;
    cursor += CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
  }
  return entries === 0 ? null : total;
}
