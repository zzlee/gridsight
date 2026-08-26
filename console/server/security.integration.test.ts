import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { generateTeacherToken, server, tokenAuth } from './server.js';

const mac = 'AA:BB:CC:DD:EE:42';
const agentToken = tokenAuth.generateToken(mac, '127.0.0.1');
const teacherToken = generateTeacherToken().token;

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});
const address = server.address();
assert(address && typeof address === 'object');
const baseHttp = `http://127.0.0.1:${address.port}`;
const baseWs = `ws://127.0.0.1:${address.port}`;

const waitForCloseCode = async (ws: WebSocket): Promise<number> => {
  const [code] = await once(ws, 'close');
  return code as number;
};

let agent: WebSocket | null = null;
let viewer: WebSocket | null = null;
try {
  const rejectedAgent = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(mac)}&token=wrong`);
  assert.equal(await waitForCloseCode(rejectedAgent), 1008);

  agent = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(mac)}&ip=127.0.0.1&token=${agentToken}`);
  await once(agent, 'open');

  const rejectedViewer = new WebSocket(`${baseWs}/ws/stream/${encodeURIComponent(mac)}?token=wrong`);
  assert.equal(await waitForCloseCode(rejectedViewer), 1008);

  const unavailableViewer = new WebSocket(`${baseWs}/ws/stream/00%3A00%3A00%3A00%3A00%3A01?token=${teacherToken}`);
  assert.equal(await waitForCloseCode(unavailableViewer), 1013);

  const commandReceived = once(agent, 'message');
  viewer = new WebSocket(`${baseWs}/ws/stream/${encodeURIComponent(mac)}?token=${teacherToken}`);
  await once(viewer, 'open');
  const [command] = await commandReceived;
  assert.match(command.toString(), /START_STREAM/);

  const healthResponse = await fetch(`${baseHttp}/api/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json() as { status: string; components?: unknown; seatsFile?: unknown };
  assert.equal(health.status, 'degraded');
  assert.ok(health.components);
  assert.equal(health.seatsFile, undefined);

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const rejectedPush = await fetch(`${baseHttp}/api/agent/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'X-Agent-MAC': mac },
    body: jpeg,
  });
  assert.equal(rejectedPush.status, 401);

  const acceptedPush = await fetch(`${baseHttp}/api/agent/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Agent-MAC': mac,
      'X-Agent-IP': '127.0.0.1',
      'X-Auth-Token': agentToken,
    },
    body: jpeg,
  });
  assert.equal(acceptedPush.status, 200);

  const rejectedRead = await fetch(`${baseHttp}/api/snapshot/${encodeURIComponent(mac)}`);
  assert.equal(rejectedRead.status, 401);

  const acceptedRead = await fetch(`${baseHttp}/api/snapshot/${encodeURIComponent(mac)}`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(acceptedRead.status, 200);
  assert.equal(acceptedRead.headers.get('content-type'), 'image/jpeg');

  console.log('WebSocket and snapshot authentication integration tests passed');
} finally {
  if (viewer && viewer.readyState < WebSocket.CLOSING) viewer.close();
  if (agent && agent.readyState < WebSocket.CLOSING) agent.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
