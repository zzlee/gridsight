import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { generateTeacherToken, server } from './server.js';

console.log('Running High-Resolution Snapshot integration tests...');

const mac = 'AA:BB:CC:DD:EE:66';
const teacherToken = generateTeacherToken().token;

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});

const address = server.address();
assert(address && typeof address === 'object');
const baseHttp = `http://127.0.0.1:${address.port}`;
const baseWs = `ws://127.0.0.1:${address.port}`;

const auth = { Authorization: `Bearer ${teacherToken}` };

let agent: WebSocket | null = null;

try {
  // 1. When agent is offline and no cache, snapshot returns 404
  const notFoundResp = await fetch(`${baseHttp}/api/snapshot/${encodeURIComponent(mac)}`, {
    headers: auth,
  });
  assert.equal(notFoundResp.status, 404);

  // 2. Connect student agent via WebSocket
  agent = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(mac)}&ip=127.0.0.1`);
  await once(agent, 'open');

  // Push standard 1 FPS snapshot to seed cache
  const normalJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x01, 0xff, 0xd9]);
  const pushResp = await fetch(`${baseHttp}/api/agent/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Agent-MAC': mac,
      'X-Agent-IP': '127.0.0.1',
      'X-Active-Window': Buffer.from('VSCode').toString('base64'),
    },
    body: normalJpeg,
  });
  assert.equal(pushResp.status, 200);

  // 3. Normal snapshot query returns the cached JPEG
  const cachedResp = await fetch(`${baseHttp}/api/snapshot/${encodeURIComponent(mac)}`, {
    headers: auth,
  });
  assert.equal(cachedResp.status, 200);
  assert.equal(cachedResp.headers.get('content-type'), 'image/jpeg');
  const cachedBody = Buffer.from(await cachedResp.arrayBuffer());
  assert.deepEqual(cachedBody, normalJpeg);

  // 4. High-resolution snapshot query: triggers WS round-trip
  const highresJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0xff, 0xd9
  ]);

  // Handle GET_HIGHRES_SNAPSHOT from server and reply with HIGHRES_SNAPSHOT_REPORT
  const handleAgentMessage = (data: Buffer | string) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.action === 'GET_HIGHRES_SNAPSHOT') {
        const report = {
          action: 'HIGHRES_SNAPSHOT_REPORT',
          image: highresJpeg.toString('base64'),
        };
        agent?.send(JSON.stringify(report));
      }
    } catch {}
  };

  agent.on('message', handleAgentMessage);

  const highresResp = await fetch(`${baseHttp}/api/snapshot/${encodeURIComponent(mac)}?highres=1`, {
    headers: auth,
  });
  assert.equal(highresResp.status, 200);
  assert.equal(highresResp.headers.get('content-type'), 'image/jpeg');
  const highresBody = Buffer.from(await highresResp.arrayBuffer());
  assert.deepEqual(highresBody, highresJpeg);
  console.log('✅ PASS: High-resolution on-demand snapshot retrieval verified successfully!');

  // 5. Querying an offline unknown MAC with highres=1 returns 502
  const unknownMac = '00:11:22:33:44:55';
  const highresOfflineResp = await fetch(`${baseHttp}/api/snapshot/${encodeURIComponent(unknownMac)}?highres=1`, {
    headers: auth,
  });
  assert.equal(highresOfflineResp.status, 502);
  const offlineErr = await highresOfflineResp.json() as { error: string };
  assert.match(offlineErr.error, /High-resolution snapshot unavailable/);
  console.log('✅ PASS: High-resolution snapshot 502 handling for offline agent verified successfully!');

} finally {
  agent?.close();
  server.close();
}
