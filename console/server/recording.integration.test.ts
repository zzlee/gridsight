import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';

// Ensure test mode for synthetic screen capture in Linux/headless
process.env.USE_TEST_SOURCE = 'true';

const { generateTeacherToken, server } = await import('./server.js');

const teacherToken = generateTeacherToken().token;
const auth = { Authorization: `Bearer ${teacherToken}` };

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});

const address = server.address();
assert(address && typeof address === 'object');
const baseHttp = `http://127.0.0.1:${address.port}`;
const baseWs = `ws://127.0.0.1:${address.port}`;

console.log('Running Teacher and Student Recording integration tests...');

let agent1: WebSocket | null = null;
let agent2: WebSocket | null = null;
const recordedFilesToClean: string[] = [];

try {
  // =========================================================================
  // Part 1: Teacher Standalone Screen Recording (Record-Only Mode)
  // =========================================================================
  console.log('\n--- Part 1: Teacher Standalone Screen Recording ---');

  // 1. Initial status check
  const initStatusResp = await fetch(`${baseHttp}/api/record/status`, { headers: auth });
  assert.equal(initStatusResp.status, 200);
  const initStatus = await initStatusResp.json() as any;
  assert.equal(initStatus.isRecording, false);
  assert.equal(initStatus.isRecordOnly, false);
  assert.equal(initStatus.isBroadcasting, false);

  // 2. Audio devices list check
  const audioDevResp = await fetch(`${baseHttp}/api/record/audio-devices`, { headers: auth });
  assert.equal(audioDevResp.status, 200);
  const audioDevData = await audioDevResp.json() as any;
  assert.equal(audioDevData.ok, true);
  assert(Array.isArray(audioDevData.devices), 'Audio devices should be an array');
  console.log(`✅ PASS: Audio devices discovered: ${audioDevData.devices.length} device(s)`);

  // 3. Start standalone recording (quality low, audio none for quick startup)
  const startRecResp = await fetch(`${baseHttp}/api/record/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ quality: 'low', audioDevice: 'none' }),
  });
  assert.equal(startRecResp.status, 200);
  const startRecData = await startRecResp.json() as any;
  assert.equal(startRecData.status, 'recording');
  assert.equal(startRecData.isRecording, true);
  assert.equal(startRecData.isRecordOnly, true);
  assert(startRecData.filename && startRecData.filename.endsWith('.mp4'), 'Filename should be an mp4');
  recordedFilesToClean.push(startRecData.fullPath);
  console.log(`✅ PASS: Teacher standalone recording started -> ${startRecData.filename}`);

  // Duplicate start while already recording
  const dupStartResp = await fetch(`${baseHttp}/api/record/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ quality: 'low', audioDevice: 'none' }),
  });
  assert.equal(dupStartResp.status, 200);
  const dupStartData = await dupStartResp.json() as any;
  assert.equal(dupStartData.alreadyRecording, true);
  console.log('✅ PASS: Duplicate teacher recording start handled idempotently');

  // Let it record for 1.5 seconds
  await new Promise((r) => setTimeout(r, 1500));

  // Check active recording status
  const activeStatusResp = await fetch(`${baseHttp}/api/record/status`, { headers: auth });
  assert.equal(activeStatusResp.status, 200);
  const activeStatus = await activeStatusResp.json() as any;
  assert.equal(activeStatus.isRecording, true);
  assert.equal(activeStatus.isRecordOnly, true);
  assert(activeStatus.durationSeconds >= 1, 'Duration should be >= 1s');
  console.log(`✅ PASS: Teacher recording status verified (duration: ${activeStatus.durationSeconds}s)`);

  // Stop standalone recording
  const stopRecResp = await fetch(`${baseHttp}/api/record/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({}),
  });
  assert.equal(stopRecResp.status, 200);
  const stopRecData = await stopRecResp.json() as any;
  assert.equal(stopRecData.status, 'stopped');
  assert(stopRecData.fileInfo && stopRecData.fileInfo.sizeBytes > 0, 'Recorded file must be non-empty');
  console.log(`✅ PASS: Teacher standalone recording stopped (size: ${stopRecData.fileInfo.sizeBytes} bytes)`);

  // Verify file on disk
  assert(fs.existsSync(startRecData.fullPath), 'Recorded file must exist on disk');
  const diskStat = fs.statSync(startRecData.fullPath);
  assert(diskStat.size > 0, 'Recorded file on disk must be > 0 bytes');

  // =========================================================================
  // Part 2: Teacher Synchronous Recording during RTP Multicast Broadcast
  // =========================================================================
  console.log('\n--- Part 2: Synchronous Recording during RTP Multicast Broadcast ---');

  const startBcastResp = await fetch(`${baseHttp}/api/broadcast/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ fps: 30, bitrateKbps: 2000, record: true, audioDevice: 'none' }),
  });
  assert.equal(startBcastResp.status, 200);
  const startBcastData = await startBcastResp.json() as any;
  assert.equal(startBcastData.active, true);
  assert.equal(startBcastData.recording, true);

  // Check status while broadcasting and recording
  const bcastStatusResp = await fetch(`${baseHttp}/api/record/status`, { headers: auth });
  const bcastStatus = await bcastStatusResp.json() as any;
  assert.equal(bcastStatus.isRecording, true);
  assert.equal(bcastStatus.isBroadcasting, true);
  assert.equal(bcastStatus.isRecordOnly, false);
  if (bcastStatus.fullPath) recordedFilesToClean.push(bcastStatus.fullPath);
  console.log(`✅ PASS: Dual-mode broadcast + sync recording live: ${bcastStatus.filename}`);

  await new Promise((r) => setTimeout(r, 1500));

  // Stop broadcast (which terminates the synchronous recording pipeline)
  const stopBcastResp = await fetch(`${baseHttp}/api/broadcast/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({}),
  });
  assert.equal(stopBcastResp.status, 200);

  // Check status after broadcast stop
  const postBcastStatusResp = await fetch(`${baseHttp}/api/record/status`, { headers: auth });
  const postBcastStatus = await postBcastStatusResp.json() as any;
  assert.equal(postBcastStatus.isRecording, false);
  assert.equal(postBcastStatus.isBroadcasting, false);
  console.log('✅ PASS: Dual-mode broadcast & recording stopped cleanly');

  // =========================================================================
  // Part 3: Recording Files Listing, Downloading, and Security Traversal Check
  // =========================================================================
  console.log('\n--- Part 3: Recording File Management & Security Defenses ---');

  const listResp = await fetch(`${baseHttp}/api/record/list`, { headers: auth });
  assert.equal(listResp.status, 200);
  const listFiles = await listResp.json() as any[];
  assert(listFiles.length >= 2, 'Should have at least 2 recordings listed');
  assert(listFiles[0].filename && listFiles[0].sizeBytes > 0, 'Listed file should have valid metadata');
  console.log(`✅ PASS: GET /api/record/list returned ${listFiles.length} recording(s)`);

  // Download test
  const testFile = listFiles[0].filename;
  const downloadResp = await fetch(`${baseHttp}/api/record/download/${encodeURIComponent(testFile)}`, { headers: auth });
  assert.equal(downloadResp.status, 200);
  const downloadedBuf = Buffer.from(await downloadResp.arrayBuffer());
  assert(downloadedBuf.length > 0, 'Downloaded file content must not be empty');
  console.log(`✅ PASS: GET /api/record/download/${testFile} successfully served ${downloadedBuf.length} bytes`);

  // Security: Path traversal defense on download
  const traversalDownload = await fetch(`${baseHttp}/api/record/download/..%2F..%2Fetc%2Fpasswd`, { headers: auth });
  assert(traversalDownload.status === 403 || traversalDownload.status === 404, 'Path traversal must be forbidden');
  console.log('✅ PASS: Path traversal attack on download safely blocked (403/404)');

  // Security: Path traversal defense on delete
  const traversalDelete = await fetch(`${baseHttp}/api/record/..%2F..%2Fetc%2Fpasswd`, {
    method: 'DELETE',
    headers: auth,
  });
  assert(traversalDelete.status === 403 || traversalDelete.status === 404, 'Path traversal delete must be forbidden');
  console.log('✅ PASS: Path traversal attack on deletion safely blocked');

  // =========================================================================
  // Part 4: Student Focus Stream Native H.264 Recording
  // =========================================================================
  console.log('\n--- Part 4: Student Focus Stream Native H.264 Recording ---');

  const studentMac = 'AA:BB:CC:DD:EE:55';
  agent1 = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(studentMac)}&ip=127.0.0.1`);
  await once(agent1, 'open');

  agent1.send(JSON.stringify({
    action: 'AGENT_INFO_REGISTER',
    hostname: 'Student-PC-05',
    username: 'alice',
    seatNo: '05',
    specs: 'Intel i7 / 16GB RAM',
    activeWindow: 'Visual Studio Code'
  }));

  // Initial student record status
  const initStudentRecResp = await fetch(`${baseHttp}/api/record/student/status?mac=${studentMac}`, { headers: auth });
  assert.equal(initStudentRecResp.status, 200);
  const initStudentRec = await initStudentRecResp.json() as any;
  assert.equal(initStudentRec.isRecording, false);

  // Start student recording
  const startStudentRecResp = await fetch(`${baseHttp}/api/record/student/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ mac: studentMac, label: 'Seat-05' }),
  });
  assert.equal(startStudentRecResp.status, 200);
  const startStudentRec = await startStudentRecResp.json() as any;
  assert.equal(startStudentRec.ok, true);
  assert.equal(startStudentRec.isRecording, true);
  assert(startStudentRec.filename.includes('Seat_05') || startStudentRec.filename.includes('Seat-05'), 'Filename should contain student label');
  console.log(`✅ PASS: Student native H.264 recording started -> ${startStudentRec.filename}`);

  // Duplicate start check
  const dupStudentRecResp = await fetch(`${baseHttp}/api/record/student/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ mac: studentMac, label: 'Seat-05' }),
  });
  assert.equal(dupStudentRecResp.status, 200);
  const dupStudentRec = await dupStudentRecResp.json() as any;
  assert.equal(dupStudentRec.alreadyRecording, true);
  console.log('✅ PASS: Duplicate student recording start handled idempotently');

  // Prepare minimal valid H.264 stream frames (SPS + PPS + IDR slice)
  const sps = Buffer.from('000000016742001f96540501ec80', 'hex');
  const pps = Buffer.from('0000000168ce06e2', 'hex');
  const idr = Buffer.concat([Buffer.from('000000016588840010', 'hex'), Buffer.alloc(512, 0xaa)]);
  const testFrame = Buffer.concat([sps, pps, idr]);

  // Feed 15 frames over WebSocket directly to the server
  for (let i = 0; i < 15; i++) {
    agent1.send(testFrame);
    await new Promise((r) => setTimeout(r, 40));
  }

  // Check student recording status while streaming
  const activeStudentRecResp = await fetch(`${baseHttp}/api/record/student/status?mac=${studentMac}`, { headers: auth });
  assert.equal(activeStudentRecResp.status, 200);
  const activeStudentRec = await activeStudentRecResp.json() as any;
  assert.equal(activeStudentRec.isRecording, true);
  assert.equal(activeStudentRec.label, 'Seat-05');
  console.log(`✅ PASS: Student recording status active: ${activeStudentRec.filename}`);

  // Stop student recording
  const stopStudentRecResp = await fetch(`${baseHttp}/api/record/student/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ mac: studentMac }),
  });
  assert.equal(stopStudentRecResp.status, 200);
  const stopStudentRec = await stopStudentRecResp.json() as any;
  assert.equal(stopStudentRec.ok, true);
  assert(stopStudentRec.sizeBytes > 0, 'Final student recording size must be > 0 bytes');
  console.log(`✅ PASS: Student recording stopped successfully (size: ${stopStudentRec.sizeBytes} bytes)`);

  // Verify status after stop
  const postStudentRecResp = await fetch(`${baseHttp}/api/record/student/status?mac=${studentMac}`, { headers: auth });
  const postStudentRec = await postStudentRecResp.json() as any;
  assert.equal(postStudentRec.isRecording, false);

  // =========================================================================
  // Part 5: Anti-Leak Disconnect Protection on Abrupt Agent Close
  // =========================================================================
  console.log('\n--- Part 5: Student Disconnect Protection (Anti-Leak) ---');

  const student2Mac = 'AA:BB:CC:DD:EE:56';
  agent2 = new WebSocket(`${baseWs}/ws/agent?mac=${encodeURIComponent(student2Mac)}&ip=127.0.0.1`);
  await once(agent2, 'open');

  await fetch(`${baseHttp}/api/record/student/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ mac: student2Mac, label: 'Seat-06' }),
  });

  // Feed one frame
  agent2.send(testFrame);
  await new Promise((r) => setTimeout(r, 100));

  // Abruptly terminate connection
  agent2.close();
  await new Promise((r) => setTimeout(r, 400));

  // Status must be automatically cleaned up
  const dcStatusResp = await fetch(`${baseHttp}/api/record/student/status?mac=${student2Mac}`, { headers: auth });
  const dcStatus = await dcStatusResp.json() as any;
  assert.equal(dcStatus.isRecording, false);
  console.log('✅ PASS: Abrupt agent disconnect auto-finalized recording and cleaned up session');

  console.log('\n🎉 ALL TEACHER AND STUDENT RECORDING INTEGRATION TESTS PASSED!');
} finally {
  agent1?.close();
  agent2?.close();
  server.close();

  // Clean up any test files created during the run
  for (const f of recordedFilesToClean) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
}
