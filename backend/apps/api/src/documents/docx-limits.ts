export const DOCX_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const DOCX_UNZIPPED_MAX_BYTES = 100 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN_BYTES = 22;
const EOCD_SEARCH_BYTES = 65_557;
const ZIP64_MARKER = 0xffffffff;

export function zipUncompressedBytes(buf: Buffer): number | null {
  if (buf.length < EOCD_MIN_BYTES) return null;
  const lowest = Math.max(0, buf.length - EOCD_SEARCH_BYTES);
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN_BYTES; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return null;
    const size = buf.readUInt32LE(offset + 24);
    if (size === ZIP64_MARKER) return Number.POSITIVE_INFINITY;
    total += size;
    offset +=
      46 +
      buf.readUInt16LE(offset + 28) +
      buf.readUInt16LE(offset + 30) +
      buf.readUInt16LE(offset + 32);
  }
  return total;
}
