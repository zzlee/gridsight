import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { generateTeacherToken, server } from './server.js';

const mac = 'AA:BB:CC:DD:EE:88';
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
  agent = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(mac)}&ip=127.0.0.1`);
  await once(agent, 'open');

  // 1. Initial check: no active roll call
  const initResp = await fetch(`${baseHttp}/api/rollcall/status`, { headers: auth });
  const initData = await initResp.json() as { active: boolean };
  assert.equal(initData.active, false);

  // 2. Start full-class roll call
  const rollCallPromise = once(agent, 'message');
  const startResp = await fetch(`${baseHttp}/api/rollcall/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      title: '第一週課堂點名',
    }),
  });
  assert.equal(startResp.status, 200);
  const startData = await startResp.json() as { ok: boolean; session: { id: string; title: string; active: boolean }; targetCount: number };
  assert.equal(startData.ok, true);
  assert.equal(startData.session.title, '第一週課堂點名');
  assert.equal(startData.session.active, true);
  assert.equal(startData.targetCount, 1);

  // Verify agent received START_ROLL_CALL WebSocket message
  const rollCallMsg = JSON.parse((await rollCallPromise)[0].toString());
  assert.equal(rollCallMsg.action, 'START_ROLL_CALL');
  assert.equal(rollCallMsg.rollCallId, startData.session.id);
  assert.equal(rollCallMsg.title, '第一週課堂點名');

  // 3. Agent submits student ID response
  agent.send(JSON.stringify({
    action: 'ROLL_CALL_RESPONSE',
    rollCallId: startData.session.id,
    studentId: 'B1103001',
  }));

  // Wait a moment for server to process
  await new Promise((r) => setTimeout(r, 200));

  // 4. Verify /api/rollcall/status shows checked in
  const statusResp = await fetch(`${baseHttp}/api/rollcall/status`, { headers: auth });
  assert.equal(statusResp.status, 200);
  const statusData = await statusResp.json() as {
    active: boolean;
    session: {
      records: Array<{ mac: string; studentId: string }>;
      totalCheckedIn: number;
    };
  };
  assert.equal(statusData.active, true);
  assert.equal(statusData.session.totalCheckedIn, 1);
  assert.equal(statusData.session.records[0]?.studentId, 'B1103001');

  // 5. Verify /api/agents reports studentId and hasCheckedIn
  const agentsResp = await fetch(`${baseHttp}/api/agents`, { headers: auth });
  const agentsData = await agentsResp.json() as {
    agents: Array<{ mac: string; studentId?: string; hasCheckedIn?: boolean }>;
  };
  const targetAgent = agentsData.agents.find((a) => a.mac.toLowerCase() === mac.toLowerCase());
  assert.ok(targetAgent);
  assert.equal(targetAgent?.studentId, 'B1103001');
  assert.equal(targetAgent?.hasCheckedIn, true);

  // 6. Test individual re-prompt for student who entered wrong ID
  const rePromptPromise = once(agent, 'message');
  const rePromptResp = await fetch(`${baseHttp}/api/rollcall/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      targets: [mac],
    }),
  });
  assert.equal(rePromptResp.status, 200);
  const rePromptMsg = JSON.parse((await rePromptPromise)[0].toString());
  assert.equal(rePromptMsg.action, 'START_ROLL_CALL');

  // Student re-submits corrected ID
  agent.send(JSON.stringify({
    action: 'ROLL_CALL_RESPONSE',
    rollCallId: startData.session.id,
    studentId: 'B1103999',
  }));
  await new Promise((r) => setTimeout(r, 200));

  // Verify corrected ID
  const statusResp2 = await fetch(`${baseHttp}/api/rollcall/status`, { headers: auth });
  const statusData2 = await statusResp2.json() as {
    session: {
      records: Array<{ mac: string; studentId: string }>;
    };
  };
  assert.equal(statusData2.session.records[0]?.studentId, 'B1103999');

  // 7. Verify CSV Export
  const csvResp = await fetch(`${baseHttp}/api/rollcall/export-csv`, { headers: auth });
  assert.equal(csvResp.status, 200);
  assert.ok(csvResp.headers.get('content-type')?.includes('text/csv'));
  const csvText = await csvResp.text();
  assert.ok(csvText.includes('B1103999'));
  assert.ok(csvText.includes('已簽到'));

  // 8. Stop roll call
  const stopPromise = once(agent, 'message');
  const stopResp = await fetch(`${baseHttp}/api/rollcall/stop`, {
    method: 'POST',
    headers: auth,
  });
  assert.equal(stopResp.status, 200);
  const stopMsg = JSON.parse((await stopPromise)[0].toString());
  assert.equal(stopMsg.action, 'STOP_ROLL_CALL');

  // 9. Verify inactive status
  const finalStatusResp = await fetch(`${baseHttp}/api/rollcall/status`, { headers: auth });
  const finalStatusData = await finalStatusResp.json() as { active: boolean };
  assert.equal(finalStatusData.active, false);

  console.log('✅ Roll Call integration test passed successfully!');
} finally {
  if (agent && agent.readyState === WebSocket.OPEN) {
    agent.close();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
