import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { generateTeacherToken, server, tokenAuth } from './server.js';

const mac = 'AA:BB:CC:DD:EE:43';
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

  // --- Share URL (broadcast to all online agents) ---
  const urlCmd = once(agent, 'message');
  const urlResp = await fetch(`${baseHttp}/api/share/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ url: 'example.com', targets: [] }),
  });
  assert.equal(urlResp.status, 200);
  const urlData = await urlResp.json() as { success: boolean; count: number; totalTargets: number; successCount: number; failedCount: number; url: string };
  assert.equal(urlData.success, true);
  assert.equal(urlData.url, 'http://example.com');
  assert.equal(urlData.count, 1);
  assert.equal(urlData.totalTargets, 1);
  assert.equal(urlData.successCount, 1);
  assert.equal(urlData.failedCount, 0);
  const urlMsg = JSON.parse((await urlCmd)[0].toString());
  assert.equal(urlMsg.action, 'OPEN_URL');
  assert.equal(urlMsg.url, 'http://example.com');

  // --- Share URL: reject empty/invalid ---
  const badUrlResp = await fetch(`${baseHttp}/api/share/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ url: '  ' }),
  });
  assert.equal(badUrlResp.status, 400);

  // --- Share URL: require auth ---
  const noAuthUrl = await fetch(`${baseHttp}/api/share/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'example.com' }),
  });
  assert.equal(noAuthUrl.status, 401);

  // --- Share File (upload + broadcast + download round trip) ---
  const fileCommand = once(agent, 'message');
  const payload = 'GridSight share integration test payload 📦';
  const fileName = 'test 分享 文件.txt';
  const fileResp = await fetch(`${baseHttp}/api/share/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent(fileName), 'x-targets': JSON.stringify([]), ...auth },
    body: payload,
  });
  assert.equal(fileResp.status, 200);
  const fileData = await fileResp.json() as {
    success: boolean;
    count: number;
    totalTargets: number;
    successCount: number;
    failedCount: number;
    fileId: string;
    filename: string;
    fileSize: number;
    downloadUrl: string;
  };
  assert.equal(fileData.success, true);
  assert.equal(fileData.count, 1);
  assert.equal(fileData.totalTargets, 1);
  assert.equal(fileData.successCount, 1);
  assert.equal(fileData.failedCount, 0);
  assert.equal(fileData.fileSize, Buffer.byteLength(payload));
  assert.equal(fileData.filename, 'test 分享 文件.txt');

  const fileMsg = JSON.parse((await fileCommand)[0].toString());
  assert.equal(fileMsg.action, 'SHARE_FILE');
  assert.equal(fileMsg.filename, 'test 分享 文件.txt');
  assert.equal(fileMsg.fileSize, Buffer.byteLength(payload));
  assert.ok(fileMsg.url.startsWith('http://'));

  // --- Download the shared file back and verify content integrity ---
  assert.ok(fileData.fileId, 'server generated fileId');
  const dlResp = await fetch(`${baseHttp}/api/share/download/${fileData.fileId}/${encodeURIComponent(fileData.filename)}`);
  assert.equal(dlResp.status, 200);
  assert.equal(dlResp.headers.get('content-type'), 'application/octet-stream');
  const dlBody = await dlResp.text();
  assert.equal(dlBody, payload, 'downloaded file content must match uploaded content');

  // --- Download: unknown fileId returns 404 ---
  const missingResp = await fetch(`${baseHttp}/api/share/download/zzzzzzzz/nope.txt`);
  assert.equal(missingResp.status, 404);

  // --- Download: reject path traversal fileId ---
  const traversalResp = await fetch(`${baseHttp}/api/share/download/..%2Fevil/steal.txt`);
  assert.equal(traversalResp.status, 400);

  // --- Share File: reject empty body ---
  const emptyResp = await fetch(`${baseHttp}/api/share/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent('empty.txt'), ...auth },
    body: '',
  });
  assert.equal(emptyResp.status, 400);

  // --- Share File: require auth ---
  const noAuthFile = await fetch(`${baseHttp}/api/share/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-filename': 'x.txt' },
    body: 'data',
  });
  assert.equal(noAuthFile.status, 401);

  console.log('Share (directory/file) integration tests passed');
} finally {
  if (agent && agent.readyState < WebSocket.CLOSING) agent.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
