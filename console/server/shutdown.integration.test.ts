import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { generateTeacherToken, server, tokenAuth } from './server.js';

const mac = 'AA:BB:CC:DD:EE:99';
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

const auth = { Authorization: `Bearer ${teacherToken}` };

let agent: WebSocket | null = null;
try {
  agent = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(mac)}&ip=127.0.0.1&token=${agentToken}`);
  await once(agent, 'open');

  // --- Shutdown: require teacher auth ---
  const noAuthResp = await fetch(`${baseHttp}/api/power/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout: 30 }),
  });
  assert.equal(noAuthResp.status, 401);

  // --- Shutdown: broadcast to connected agent ---
  const shutdownCmdPromise = once(agent, 'message');
  const shutdownResp = await fetch(`${baseHttp}/api/power/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ targets: ['ALL'], timeout: 30 }),
  });
  assert.equal(shutdownResp.status, 200);
  const shutdownData = (await shutdownResp.json()) as { success: boolean; count: number; timeout: number; message: string };
  assert.equal(shutdownData.success, true);
  assert.equal(shutdownData.count, 1);
  assert.equal(shutdownData.timeout, 30);

  const shutdownMsg = JSON.parse((await shutdownCmdPromise)[0].toString());
  assert.equal(shutdownMsg.action, 'SHUTDOWN');
  assert.equal(shutdownMsg.timeout, 30);

  // --- Shutdown: targeted MAC address ---
  const targetedCmdPromise = once(agent, 'message');
  const targetedResp = await fetch(`${baseHttp}/api/power/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ targets: [mac], timeout: 15 }),
  });
  assert.equal(targetedResp.status, 200);
  const targetedData = (await targetedResp.json()) as { success: boolean; count: number; timeout: number };
  assert.equal(targetedData.success, true);
  assert.equal(targetedData.count, 1);
  assert.equal(targetedData.timeout, 15);

  const targetedMsg = JSON.parse((await targetedCmdPromise)[0].toString());
  assert.equal(targetedMsg.action, 'SHUTDOWN');
  assert.equal(targetedMsg.timeout, 15);

  console.log('Shutdown integration tests passed successfully! 🎉');
} finally {
  if (agent && agent.readyState < WebSocket.CLOSING) agent.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
