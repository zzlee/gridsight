import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { generateTeacherToken, server } from './server.js';

const mac = 'AA:BB:CC:DD:EE:77';
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

  // 1. Initial check: no active assignment
  const initResp = await fetch(`${baseHttp}/api/assignments/active`, { headers: auth });
  const initData = await initResp.json() as { active: boolean };
  assert.equal(initData.active, false);

  // 2. Start assignment collection
  const collectPromise = once(agent, 'message');
  const startResp = await fetch(`${baseHttp}/api/assignments/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      title: '第 1 次作業：矩陣運算',
      allowedExts: ['cpp', 'py'],
      maxSizeMb: 10,
    }),
  });
  assert.equal(startResp.status, 200);
  const startData = await startResp.json() as { ok: boolean; session: { id: string; title: string } };
  assert.equal(startData.ok, true);
  assert.equal(startData.session.title, '第 1 次作業：矩陣運算');
  const assignmentId = startData.session.id;

  // Verify agent received COLLECT_ASSIGNMENT WebSocket message
  const collectMsg = JSON.parse((await collectPromise)[0].toString());
  assert.equal(collectMsg.action, 'COLLECT_ASSIGNMENT');
  assert.equal(collectMsg.id, assignmentId);
  assert.equal(collectMsg.title, '第 1 次作業：矩陣運算');

  // 3. Upload a homework file from agent
  const fileContent = Buffer.from('#include <iostream>\nint main() { std::cout << "Hello"; return 0; }', 'utf8');
  const uploadResp = await fetch(`${baseHttp}/api/assignments/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Agent-MAC': mac,
      'X-Agent-IP': '127.0.0.1',
      'X-Assignment-Id': assignmentId,
      'X-Filename': Buffer.from('matrix.cpp', 'utf8').toString('base64'),
    },
    body: fileContent,
  });
  assert.equal(uploadResp.status, 200);
  const uploadData = await uploadResp.json() as { ok: boolean; filename: string; size: number; submittedAt: number };
  assert.equal(uploadData.ok, true);
  assert(uploadData.filename.endsWith('matrix.cpp'));
  assert.equal(uploadData.size, fileContent.length);

  // 3.1 Overwrite update (Option 2-A: Student uploads newer version)
  const updatedContent = Buffer.from('#include <iostream>\nint main() { std::cout << "V2 Final"; return 0; }', 'utf8');
  const reuploadResp = await fetch(`${baseHttp}/api/assignments/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Agent-MAC': mac,
      'X-Agent-IP': '127.0.0.1',
      'X-Assignment-Id': assignmentId,
      'X-Filename': Buffer.from('matrix.cpp', 'utf8').toString('base64'),
    },
    body: updatedContent,
  });
  assert.equal(reuploadResp.status, 200);
  const reuploadData = await reuploadResp.json() as { ok: boolean; size: number };
  assert.equal(reuploadData.ok, true);
  assert.equal(reuploadData.size, updatedContent.length);

  // 3.2 Rejection of disallowed extension (.exe when only cpp,py allowed)
  const badExtResp = await fetch(`${baseHttp}/api/assignments/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Agent-MAC': mac,
      'X-Agent-IP': '127.0.0.1',
      'X-Assignment-Id': assignmentId,
      'X-Filename': Buffer.from('trojan.exe', 'utf8').toString('base64'),
    },
    body: Buffer.from('fake exe content', 'utf8'),
  });
  assert.equal(badExtResp.status, 400);

  // 3.3 Rejection of empty file
  const emptyResp = await fetch(`${baseHttp}/api/assignments/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Agent-MAC': mac,
      'X-Agent-IP': '127.0.0.1',
      'X-Assignment-Id': assignmentId,
      'X-Filename': Buffer.from('matrix.cpp', 'utf8').toString('base64'),
    },
    body: Buffer.alloc(0),
  });
  assert.equal(emptyResp.status, 400);

  // 3.4 Rejection of non-existent assignment
  const fakeIdResp = await fetch(`${baseHttp}/api/assignments/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Agent-MAC': mac,
      'X-Agent-IP': '127.0.0.1',
      'X-Assignment-Id': 'as-nonexistent-session',
      'X-Filename': Buffer.from('matrix.cpp', 'utf8').toString('base64'),
    },
    body: fileContent,
  });
  assert.equal(fakeIdResp.status, 404);

  // 4. Verify /api/assignments/active reports submission
  const activeResp = await fetch(`${baseHttp}/api/assignments/active`, { headers: auth });
  const activeData = await activeResp.json() as { active: boolean; session: { submissions: Array<{ mac: string; filename: string; size: number }> } };
  assert.equal(activeData.active, true);
  assert.equal(activeData.session.submissions.length, 1);
  assert.equal(activeData.session.submissions[0]!.mac.toLowerCase(), mac.toLowerCase());
  assert.equal(activeData.session.submissions[0]!.size, updatedContent.length);

  // 5. Download ZIP archive
  const zipResp = await fetch(`${baseHttp}/api/assignments/${assignmentId}/download-zip`, { headers: auth });
  assert.equal(zipResp.status, 200);
  assert.equal(zipResp.headers.get('Content-Type'), 'application/zip');
  const zipBuffer = Buffer.from(await zipResp.arrayBuffer());
  assert(zipBuffer.length > 0);
  // Zip signature PK\x03\x04
  assert.equal(zipBuffer.readUInt32LE(0), 0x04034b50);

  // 5.1 Verify /api/assignments/list includes the session
  const historyResp = await fetch(`${baseHttp}/api/assignments/list`, { headers: auth });
  assert.equal(historyResp.status, 200);
  const historyData = await historyResp.json() as { list: Array<{ id: string; title: string }> };
  assert(historyData.list.some((s) => s.id === assignmentId));

  // 6. Stop assignment collection
  const stopPromise = once(agent, 'message');
  const stopResp = await fetch(`${baseHttp}/api/assignments/stop`, {
    method: 'POST',
    headers: auth,
  });
  assert.equal(stopResp.status, 200);
  const stopMsg = JSON.parse((await stopPromise)[0].toString());
  assert.equal(stopMsg.action, 'STOP_ASSIGNMENT');

  // Verify /api/assignments/active is now false
  const postStopResp = await fetch(`${baseHttp}/api/assignments/active`, { headers: auth });
  const postStopData = await postStopResp.json() as { active: boolean };
  assert.equal(postStopData.active, false);

  console.log('✅ PASS: Assignment collection integration tests passed successfully!');
} finally {
  agent?.close();
  server.close();
}
