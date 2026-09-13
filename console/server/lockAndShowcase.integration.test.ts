import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { generateTeacherToken, server } from './server.js';

const mac = 'AA:BB:CC:DD:EE:99';
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
let agent2: WebSocket | null = null;

try {
  agent = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(mac)}&ip=127.0.0.1`);
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

  // 4. Anti-Bypass test: Reconnect while locked
  // Student restarts gs-agent or reboots; newly connected agent must be auto-relocked
  agent.close();
  await new Promise((r) => setTimeout(r, 100));

  agent2 = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(mac)}&ip=127.0.0.1`);
  const reconnectLockPromise = once(agent2, 'message');
  await once(agent2, 'open');

  const reconnectLockMsg = JSON.parse((await reconnectLockPromise)[0].toString());
  assert.equal(reconnectLockMsg.action, 'LOCK_SCREEN');
  assert.equal(reconnectLockMsg.message, '專心聽講');
  console.log('✅ PASS: Anti-bypass verified - Agent auto-relocked upon reconnection');

  // 5. Unlock screen
  const unlockPromise = once(agent2, 'message');
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

  // 6. Check showcase status endpoint
  const showcaseStatusResp = await fetch(`${baseHttp}/api/broadcast/showcase/status`, { headers: auth });
  assert.equal(showcaseStatusResp.status, 200);
  const showcaseStatus = await showcaseStatusResp.json() as { active: boolean; studentMac: string | null };
  assert.equal(showcaseStatus.active, false);

  // 7. Test Showcase Start & Stop
  const showcaseMessages: any[] = [];
  agent2.on('message', (data) => {
    try {
      showcaseMessages.push(JSON.parse(data.toString()));
    } catch {}
  });

  const startShowcaseResp = await fetch(`${baseHttp}/api/broadcast/showcase/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ mac }),
  });
  assert.equal(startShowcaseResp.status, 200);
  const startShowcaseData = await startShowcaseResp.json() as { ok: boolean; status: string };
  assert.equal(startShowcaseData.ok, true);
  assert.equal(startShowcaseData.status, 'showcase_streaming');

  // Wait a moment for WS commands to be received
  await new Promise((r) => setTimeout(r, 200));
  assert(showcaseMessages.some((m) => m.action === 'SHOWCASE_START'), 'SHOWCASE_START received');
  assert(showcaseMessages.some((m) => m.action === 'START_STREAM'), 'START_STREAM received');

  const activeShowcaseResp = await fetch(`${baseHttp}/api/broadcast/showcase/status`, { headers: auth });
  const activeShowcase = await activeShowcaseResp.json() as { active: boolean; studentMac: string | null };
  assert.equal(activeShowcase.active, true);
  assert.equal(activeShowcase.studentMac, mac.toLowerCase());

  // Stop Showcase
  showcaseMessages.length = 0;
  const stopShowcaseResp = await fetch(`${baseHttp}/api/broadcast/showcase/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ mac }),
  });
  assert.equal(stopShowcaseResp.status, 200);

  await new Promise((r) => setTimeout(r, 200));
  assert(showcaseMessages.some((m) => m.action === 'SHOWCASE_STOP'), 'SHOWCASE_STOP received');
  assert(showcaseMessages.some((m) => m.action === 'STOP_STREAM'), 'STOP_STREAM received');

  const finalShowcaseResp = await fetch(`${baseHttp}/api/broadcast/showcase/status`, { headers: auth });
  const finalShowcase = await finalShowcaseResp.json() as { active: boolean };
  assert.equal(finalShowcase.active, false);
  console.log('✅ PASS: Student showcase start and stop lifecycle verified');

  console.log('✅ PASS: Screen lockout, anti-bypass, and showcase integration tests completed successfully!');
} finally {
  agent?.close();
  agent2?.close();
  server.close();
}
