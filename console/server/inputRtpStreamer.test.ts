import assert from 'node:assert';
import { TeacherInputRtpStreamer, InputEventType, type InputEventData } from './inputRtpStreamer.js';

console.log('Running TeacherInputRtpStreamer tests...');

const streamer = new TeacherInputRtpStreamer({ ssrc: 0x12345678 });

// Test 1: createRtpPacket structure & contents
const event: InputEventData = {
  eventType: InputEventType.MouseMove,
  normX: 32768,
  normY: 16384,
  buttonFlags: 0x01,
  scrollDelta: 120,
  modifierFlags: 0x02,
  keyCode: 65,
  timestampMs: 1700000000000,
};

const packet = streamer.createRtpPacket(event);

assert.strictEqual(packet.length, 33, 'Packet length should be 33 bytes (12 header + 21 payload)');
assert.strictEqual(packet.readUInt8(0), 0x80, 'RTP Version should be 2 (0x80)');
assert.strictEqual(packet.readUInt8(1), 0x62, 'RTP PT should be 98 (0x62)');
assert.strictEqual(packet.readUInt16BE(2), 0, 'Initial sequence number should be 0');
assert.strictEqual(packet.readUInt32BE(8), 0x12345678, 'SSRC should match initialized value');

assert.strictEqual(packet.readUInt8(12), InputEventType.MouseMove, 'Payload eventType');
assert.strictEqual(packet.readUInt16BE(13), 32768, 'Payload normX');
assert.strictEqual(packet.readUInt16BE(15), 16384, 'Payload normY');
assert.strictEqual(packet.readUInt8(17), 0x01, 'Payload buttonFlags');
assert.strictEqual(packet.readInt16BE(18), 120, 'Payload scrollDelta');
assert.strictEqual(packet.readUInt8(20), 0x02, 'Payload modifierFlags');
assert.strictEqual(packet.readUInt32BE(21), 65, 'Payload keyCode');
assert.strictEqual(Number(packet.readBigUInt64BE(25)), 1700000000000, 'Payload timestampMs');

console.log('✅ Test 1 passed: RTP packet binary structure is correct.');

// Test 2: Sequence number incrementing
const p1 = streamer.createRtpPacket(event);
assert.strictEqual(p1.readUInt16BE(2), 1, 'Sequence number should be 1');

console.log('✅ Test 2 passed: Sequence numbers increment correctly.');

// Test 3: Lifecycle start & stop
assert.strictEqual(streamer.isActive(), false, 'Should be inactive initially');
assert.strictEqual(streamer.start(), true, 'Start should return true');
assert.strictEqual(streamer.isActive(), true, 'Should be active after start');
streamer.stop();
assert.strictEqual(streamer.isActive(), false, 'Should be inactive after stop');

console.log('✅ Test 3 passed: Streamer lifecycle start and stop works.');

console.log('All TeacherInputRtpStreamer unit tests passed successfully! 🎉');
