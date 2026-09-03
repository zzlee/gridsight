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

  // 1. Initial screen status check
  const initStatusResp = await fetch(`${baseHttp}/api/screen/status`, { headers: auth });
  assert.equal(initStatusResp.status, 200);
  const initStatus = await initStatusResp.json() as { lockedCount: number; lockedMacs: string[] };
  assert.equal(typeof initStatus.lockedCount, 'number');

  // 2. Lock screen
  const lockPromise = once(agent, 'message');
  const lockResp = await fetch(`${baseHttp}/api/screen/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ targets: [mac], message: '專心聽講' }),
  });
  assert.equal(lockResp.status, 200);
  const lockData = await lockResp.json() as { ok: boolean; lockedCount: number };
  assert.equal(lockData.ok, true);
  assert.equal(lockData.lockedCount, 1);

  const lockMsg = JSON.parse((await lockPromise)[0].toString());
  assert.equal(lockMsg.action, 'LOCK_SCREEN');
  assert.equal(lockMsg.message, '專心聽講');

  // 3. Check status after lock
  const lockedStatusResp = await fetch(`${baseHttp}/api/screen/status`, { headers: auth });
  const lockedStatus = await lockedStatusResp.json() as { lockedCount: number; lockedMacs: string[] };
  assert.equal(lockedStatus.lockedMacs.includes(mac.toLowerCase()), true);

  // 4. Unlock screen
  const unlockPromise = once(agent, 'message');
  const unlockResp = await fetch(`${baseHttp}/api/screen/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ targets: [mac] }),
  });
  assert.equal(unlockResp.status, 200);
  const unlockData = await unlockResp.json() as { ok: boolean; unlockedCount: number };
  assert.equal(unlockData.ok, true);
  assert.equal(unlockData.unlockedCount, 1);

  const unlockMsg = JSON.parse((await unlockPromise)[0].toString());
  assert.equal(unlockMsg.action, 'UNLOCK_SCREEN');

  // 5. Check showcase status endpoint
  const showcaseStatusResp = await fetch(`${baseHttp}/api/broadcast/showcase/status`, { headers: auth });
  assert.equal(showcaseStatusResp.status, 200);
  const showcaseStatus = await showcaseStatusResp.json() as { active: boolean; studentMac: string | null };
  assert.equal(showcaseStatus.active, false);

  console.log('✅ PASS: Screen lockout and showcase integration tests completed successfully!');
} finally {
  agent?.close();
  server.close();
}
