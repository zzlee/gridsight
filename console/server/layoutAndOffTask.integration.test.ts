import assert from 'node:assert/strict';
import { generateTeacherToken, server } from './server.js';
import type { ClassroomLayout } from './types.js';

console.log('Running Layout and Off-Task integration tests...');

const mac = 'AA:BB:CC:DD:EE:55';
const teacherToken = generateTeacherToken().token;

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});

const address = server.address();
assert(address && typeof address === 'object');
const baseHttp = `http://127.0.0.1:${address.port}`;
const auth = { Authorization: `Bearer ${teacherToken}` };

try {
  // 1. Initial GET /api/layout
  const getLayoutResp1 = await fetch(`${baseHttp}/api/layout`, { headers: auth });
  assert.equal(getLayoutResp1.status, 200);
  const data1 = await getLayoutResp1.json() as { success: boolean; layout: ClassroomLayout };
  assert.equal(data1.success, true);
  const layout1 = data1.layout;
  assert(Array.isArray(layout1.offTaskKeywords), 'offTaskKeywords should be an array');
  assert(layout1.cols >= 4, 'cols should be >= 4');

  // 2. POST /api/layout: Save customized layout with aisles, obstacles, and offTaskKeywords
  const customLayout: ClassroomLayout = {
    ...layout1,
    id: 'test-layout-custom',
    name: '測試自訂電腦教室',
    cols: 10,
    rows: 8,
    aisles: [
      { id: 'aisle-v-1', type: 'vertical', index: 5, name: '中央走道' },
      { id: 'aisle-h-1', type: 'horizontal', index: 4, name: '橫向走道' },
    ],
    obstacles: [
      { id: 'obs-podium-1', type: 'podium', x: 4, y: 0, w: 2, h: 1, name: '主講台' },
    ],
    offTaskKeywords: ['Steam', 'YouTube', 'Minecraft', 'CustomOffTaskGame'],
  };

  const saveResp = await fetch(`${baseHttp}/api/layout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(customLayout),
  });
  assert.equal(saveResp.status, 200);

  // 3. Verify persistence
  const getLayoutResp2 = await fetch(`${baseHttp}/api/layout`, { headers: auth });
  assert.equal(getLayoutResp2.status, 200);
  const data2 = await getLayoutResp2.json() as { success: boolean; layout: ClassroomLayout };
  const layout2 = data2.layout;
  assert.equal(layout2.cols, 10);
  assert.equal(layout2.rows, 8);
  assert.equal(layout2.aisles.length, 2);
  assert.equal(layout2.obstacles.length, 1);
  assert.equal(layout2.obstacles[0].name, '主講台');
  assert(layout2.offTaskKeywords.includes('CustomOffTaskGame'), 'Custom offTaskKeyword should be persisted');
  console.log('✅ PASS: Classroom layout, aisles, obstacles, and offTaskKeywords persisted properly');

  // 4. Test Active Window reporting via snapshot headers
  const snapshotData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x05, 0xff, 0xd9]);
  const activeWinTitle = 'CustomOffTaskGame - Room 42';
  const pushResp = await fetch(`${baseHttp}/api/agent/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Agent-MAC': mac,
      'X-Agent-IP': '127.0.0.1',
      'X-Active-Window': Buffer.from(activeWinTitle).toString('base64'),
    },
    body: snapshotData,
  });
  assert.equal(pushResp.status, 200);

  // 5. Query /api/agents and verify activeWindow is reported
  const agentsResp = await fetch(`${baseHttp}/api/agents`, { headers: auth });
  assert.equal(agentsResp.status, 200);
  const dataAgents = await agentsResp.json() as { agents: Array<{ mac: string; activeWindow?: string }> };
  const targetDevice = dataAgents.agents.find((d) => d.mac.toLowerCase() === mac.toLowerCase());
  assert(targetDevice, 'Target device should be present in agents list');
  assert.equal(targetDevice.activeWindow, activeWinTitle);
  console.log('✅ PASS: Active window title correctly extracted from X-Active-Window header');

  // 6. Query /api/snapshots/batch and verify activeWindow is propagated
  const batchResp = await fetch(`${baseHttp}/api/snapshots/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      requests: [{ id: mac, since: 0 }],
    }),
  });
  assert.equal(batchResp.status, 200);
  const batchData = await batchResp.json() as { results: Array<{ id: string; activeWindow?: string }> };
  assert.equal(batchData.results.length, 1);
  assert.equal(batchData.results[0].activeWindow, activeWinTitle);
  console.log('✅ PASS: Batch snapshot query propagates activeWindow state');

  // 7. Cleanup layout back to baseline
  await fetch(`${baseHttp}/api/layout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(layout1),
  });

  console.log('✅ PASS: Layout & Off-Task integration tests completed successfully!');
} finally {
  server.close();
}
