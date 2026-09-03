import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Precomputed CRC32 lookup table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

export function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] ?? 0;
    const tableVal = crcTable[(crc ^ b) & 0xff] ?? 0;
    crc = tableVal ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Buffer;
  mtime?: Date;
}

export function createZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.name, 'utf8');
    const uncompressedSize = entry.data.length;
    const crc = computeCrc32(entry.data);
    const compressedData = zlib.deflateRawSync(entry.data, { level: 6 });
    const compressedSize = compressedData.length;

    const d = entry.mtime || new Date();
    const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

    // --- Local File Header (30 bytes + name + compressedData) ---
    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0); // signature PK\x03\x04
    localHdr.writeUInt16LE(20, 4);         // version needed: 2.0
    localHdr.writeUInt16LE(0x0800, 6);     // flags: bit 11 = UTF-8
    localHdr.writeUInt16LE(8, 8);          // compression: 8 (deflate)
    localHdr.writeUInt16LE(dosTime, 10);
    localHdr.writeUInt16LE(dosDate, 12);
    localHdr.writeUInt32LE(crc, 14);
    localHdr.writeUInt32LE(compressedSize, 18);
    localHdr.writeUInt32LE(uncompressedSize, 22);
    localHdr.writeUInt16LE(filenameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);         // extra length

    const localEntryBuf = Buffer.concat([localHdr, filenameBuf, compressedData]);
    localHeaders.push(localEntryBuf);

    // --- Central Directory Header (46 bytes + name) ---
    const cdHdr = Buffer.alloc(46);
    cdHdr.writeUInt32LE(0x02014b50, 0);    // signature PK\x01\x02
    cdHdr.writeUInt16LE(0x0314, 4);        // version made by (UNIX 2.0)
    cdHdr.writeUInt16LE(20, 6);            // version needed: 2.0
    cdHdr.writeUInt16LE(0x0800, 8);        // flags: bit 11 = UTF-8
    cdHdr.writeUInt16LE(8, 10);            // compression: 8 (deflate)
    cdHdr.writeUInt16LE(dosTime, 12);
    cdHdr.writeUInt16LE(dosDate, 14);
    cdHdr.writeUInt32LE(crc, 16);
    cdHdr.writeUInt32LE(compressedSize, 20);
    cdHdr.writeUInt32LE(uncompressedSize, 24);
    cdHdr.writeUInt16LE(filenameBuf.length, 28);
    cdHdr.writeUInt16LE(0, 30);            // extra length
    cdHdr.writeUInt16LE(0, 32);            // comment length
    cdHdr.writeUInt16LE(0, 34);            // disk number start
    cdHdr.writeUInt16LE(0, 36);            // internal file attributes
    cdHdr.writeUInt32LE(0x81a40000, 38);   // external file attributes: 0644
    cdHdr.writeUInt32LE(offset, 42);       // relative offset of local header

    const cdEntryBuf = Buffer.concat([cdHdr, filenameBuf]);
    centralHeaders.push(cdEntryBuf);

    offset += localEntryBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuf.length;
  const centralDirOffset = offset;

  // --- End of Central Directory Record (22 bytes) ---
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // signature PK\x05\x06
  eocd.writeUInt16LE(0, 4);                // disk number
  eocd.writeUInt16LE(0, 6);                // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);   // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);  // total entries
  eocd.writeUInt32LE(centralDirSize, 12);  // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16);// central dir offset
  eocd.writeUInt16LE(0, 20);               // comment length

  return Buffer.concat([...localHeaders, centralDirBuf, eocd]);
}

/**
 * Creates a zip buffer from all files within a directory
 */
export function createZipFromDirectory(dirPath: string): Buffer {
  if (!fs.existsSync(dirPath)) {
    return createZipBuffer([]);
  }
  const files = fs.readdirSync(dirPath);
  const entries: ZipEntryInput[] = [];

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        const data = fs.readFileSync(fullPath);
        entries.push({
          name: file,
          data,
          mtime: stat.mtime,
        });
      }
    } catch {
      // skip unreadable
    }
  }

  return createZipBuffer(entries);
}
