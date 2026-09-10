import assert from 'node:assert/strict';
import { generateTeacherToken, server, tokenAuth } from './server.js';

console.log('Running Batch Snapshot and Delta Polling integration tests...');

const teacherToken = generateTeacherToken().token;

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});

const address = server.address();
assert(address && typeof address === 'object');
const baseHttp = `http://127.0.0.1:${address.port}`;

try {
  // 1. Setup 20 mock student devices with snapshots
  const agentCount = 20;
  const agents: Array<{ mac: string; ip: string; token: string }> = [];

  for (let i = 1; i <= agentCount; i++) {
    const hex = i.toString(16).padStart(2, '0');
    const mac = `AA:BB:CC:DD:01:${hex}`;
    const ip = `192.168.1.${100 + i}`;
    const token = tokenAuth.generateToken(mac, ip);
    agents.push({ mac, ip, token });

    // Mock realistic JPEG header & content
    const mockJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, i, 0xff, 0xd9]);
    const pushResp = await fetch(`${baseHttp}/api/agent/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Agent-MAC': mac,
        'X-Agent-IP': ip,
        'X-Auth-Token': token,
        'X-Active-Window': Buffer.from(`App #${i}`).toString('base64'),
      },
      body: mockJpeg,
    });
    assert.equal(pushResp.status, 200, `Agent #${i} snapshot push succeeded`);
  }

  console.log(`✅ Successfully seeded ${agentCount} mock agents into server snapshot cache`);

  // 2. Initial Batch Query: All 20 agents requested with since=0
  const initialBatchResp = await fetch(`${baseHttp}/api/snapshots/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      requests: agents.map((a) => ({ id: a.mac, since: 0 })),
    }),
  });
  assert.equal(initialBatchResp.status, 200);

  const initialJson = (await initialBatchResp.json()) as {
    results: Array<{
      id: string;
      notModified: boolean;
      timestamp?: number;
      data?: string;
      activeWindow?: string;
    }>;
  };

  assert.equal(initialJson.results.length, agentCount);
  const timestamps = new Map<string, number>();

  for (const res of initialJson.results) {
    assert.equal(res.notModified, false, 'Initial query should mark notModified: false');
    assert.ok(res.data, 'Initial query must include base64 data');
    assert.ok(res.timestamp, 'Timestamp must be present');
    timestamps.set(res.id, res.timestamp);
  }
  console.log(`✅ Initial batch query returned 20 fresh snapshots with base64 payloads`);

  // 3. Delta Batch Query: Query with 'since' set to previous timestamps (simulating static screens)
  const deltaResp = await fetch(`${baseHttp}/api/snapshots/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      requests: agents.map((a) => ({
        id: a.mac,
        since: timestamps.get(a.mac) || 0,
      })),
    }),
  });
  assert.equal(deltaResp.status, 200);

  const deltaJson = (await deltaResp.json()) as {
    results: Array<{ id: string; notModified: boolean; data?: string }>;
  };

  assert.equal(deltaJson.results.length, agentCount);
  for (const res of deltaJson.results) {
    assert.equal(res.notModified, true, 'Static screens must return notModified: true');
    assert.equal(res.data, undefined, 'notModified results must NOT contain data payloads');
  }
  console.log(`✅ Delta batch query verified: 20/20 agents returned notModified: true with 0 bytes image payload`);

  // 4. Partial Change Simulation: 2 agents update their screen
  const changedAgents = [agents[3], agents[7]];
  for (const chg of changedAgents) {
    await new Promise((r) => setTimeout(r, 5));
    const newJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x99, 0xff, 0xd9]);
    await fetch(`${baseHttp}/api/agent/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Agent-MAC': chg.mac,
        'X-Agent-IP': chg.ip,
        'X-Auth-Token': chg.token,
      },
      body: newJpeg,
    });
  }

  // Query again with previous timestamps
  const partialResp = await fetch(`${baseHttp}/api/snapshots/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      requests: agents.map((a) => ({
        id: a.mac,
        since: timestamps.get(a.mac) || 0,
      })),
    }),
  });
  assert.equal(partialResp.status, 200);

  const partialJson = (await partialResp.json()) as {
    results: Array<{ id: string; notModified: boolean; data?: string }>;
  };

  const changedIds = new Set(changedAgents.map((a) => a.mac));
  let modifiedCount = 0;
  let notModifiedCount = 0;

  for (const res of partialJson.results) {
    if (changedIds.has(res.id)) {
      assert.equal(res.notModified, false, 'Changed agents must have notModified: false');
      assert.ok(res.data, 'Changed agents must have new image data');
      modifiedCount++;
    } else {
      assert.equal(res.notModified, true, 'Unchanged agents must remain notModified: true');
      assert.equal(res.data, undefined);
      notModifiedCount++;
    }
  }

  assert.equal(modifiedCount, 2);
  assert.equal(notModifiedCount, 18);
  console.log(`✅ Partial delta check verified: exactly 2 updated agents returned data; 18 static agents returned notModified: true`);

  console.log('\nAll Batch Snapshot & Delta Polling tests passed successfully! 🎉');
} finally {
  server.close();
}
