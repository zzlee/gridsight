import assert from 'node:assert/strict';
import { createZipBuffer, computeCrc32 } from './zipPacker.js';

console.log('Running ZipPacker unit tests...');

// 1. Check CRC32
const testBuf = Buffer.from('hello world', 'utf8');
const crc = computeCrc32(testBuf);
assert.equal(typeof crc, 'number');
assert.equal(crc > 0, true);

// 2. Create Zip buffer
const zipBuf = createZipBuffer([
  { name: 'test1.txt', data: Buffer.from('Hello GridSight!', 'utf8') },
  { name: '子資料夾/作業.cpp', data: Buffer.from('#include <iostream>\nint main(){return 0;}', 'utf8') }
]);

assert(zipBuf.length > 0);
// Check standard zip signature PK\x03\x04
assert.equal(zipBuf.readUInt32LE(0), 0x04034b50);

console.log('✅ PASS: ZipPacker generates valid zip archive headers and buffers!');
