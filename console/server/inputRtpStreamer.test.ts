import assert from 'node:assert';
import dgram from 'node:dgram';
import { TeacherInputRtpStreamer, InputEventType, type InputEventData } from './inputRtpStreamer.js';
import { parseEventLine, MouseHighlightOverlay } from './mouseHighlight.js';

console.log('Running Enhanced TeacherInputRtpStreamer tests...');

const streamer = new TeacherInputRtpStreamer({ ssrc: 0x12345678, redundantCount: 2, heartbeatIntervalMs: 200 });

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

const packet = streamer.createRtpPacket(event, 0);

assert.strictEqual(packet.length, 33, 'Packet length should be 33 bytes (12 header + 21 payload)');
assert.strictEqual(packet.readUInt8(0), 0x80, 'RTP Version should be 2 (0x80)');
assert.strictEqual(packet.readUInt8(1), 0x62, 'RTP PT should be 98 (0x62)');
assert.strictEqual(packet.readUInt16BE(2), 0, 'Initial sequence number should match customSeq 0');
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

// Test 2: Sequence number allocation
const p1 = streamer.createRtpPacket(event);
const p2 = streamer.createRtpPacket(event);
assert.strictEqual(p1.readUInt16BE(2), 0, 'Sequence number should be 0');
assert.strictEqual(p2.readUInt16BE(2), 1, 'Sequence number should be 1');

console.log('✅ Test 2 passed: Sequence numbers increment correctly.');

// Test 3: Lifecycle start & stop
assert.strictEqual(streamer.isActive(), false, 'Should be inactive initially');
assert.strictEqual(streamer.start(), true, 'Start should return true');
assert.strictEqual(streamer.isActive(), true, 'Should be active after start');
streamer.stop();
assert.strictEqual(streamer.isActive(), false, 'Should be inactive after stop');

console.log('✅ Test 3 passed: Streamer lifecycle start and stop works.');

// Test 4: Live UDP Network Transmission and Reception Verification
async function testLiveNetworkTransmission() {
  const testPort = 19002;
  const testStreamer = new TeacherInputRtpStreamer({
    multicastIp: '127.0.0.1', // Use loopback for reliable unit testing without NIC multicast dependencies
    port: testPort,
    ssrc: 0x99887766,
    redundantCount: 1,
    heartbeatIntervalMs: 5000,
  });

  const receiver = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise<void>((resolve) => receiver.bind(testPort, '127.0.0.1', () => resolve()));

  const receivedPackets: Buffer[] = [];
  receiver.on('message', (msg) => {
    receivedPackets.push(msg);
  });

  testStreamer.start();

  // Feed a real mouse event parsed from overlay stdout format
  const evLine = 'EV 2 45000 30000 1 0 0 0 1700000005000';
  const inputEvent = parseEventLine(evLine)!;
  assert.ok(inputEvent, 'parseEventLine should succeed');

  const sent = testStreamer.sendEvent(inputEvent);
  assert.strictEqual(sent, true, 'sendEvent should return true');

  // Wait for packet reception
  await new Promise((r) => setTimeout(r, 100));

  assert.ok(receivedPackets.length > 0, 'Receiver should have received at least 1 packet');
  const rx = receivedPackets[0]!;
  assert.strictEqual(rx.length, 33, 'Received packet must be exactly 33 bytes');
  assert.strictEqual(rx.readUInt8(0), 0x80, 'RTP Version should be 2');
  assert.strictEqual(rx.readUInt8(1), 0x62, 'RTP Payload Type should be 98');
  assert.strictEqual(rx.readUInt32BE(8), 0x99887766, 'SSRC should match testStreamer');

  // Verify payload fields
  assert.strictEqual(rx.readUInt8(12), InputEventType.MouseDown, 'Event type should be MouseDown');
  assert.strictEqual(rx.readUInt16BE(13), 45000, 'normX should match');
  assert.strictEqual(rx.readUInt16BE(15), 30000, 'normY should match');
  assert.strictEqual(rx.readUInt8(17), 1, 'buttonFlags should be 1 (Left click)');
  assert.strictEqual(Number(rx.readBigUInt64BE(25)), 1700000005000, 'timestampMs should match');

  testStreamer.stop();
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  console.log('✅ Test 4 passed: Live UDP transmission and RTP packet reception verified successfully.');
}

await testLiveNetworkTransmission();

console.log('\nAll TeacherInputRtpStreamer unit tests passed successfully! 🎉');
