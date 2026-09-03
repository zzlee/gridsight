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

  // --- Regression: malformed MAC percent-encoding must never crash the server ---
  // URLSearchParams already decodes %25 -> '%', and decodeURIComponent('%')
  // throws. normalizeTarget must not let that exception escape the (pre-auth)
  // WebSocket connection handler.
  {
    const malformedMac = new WebSocket(`${baseWs}/ws/agent?mac=%25&token=x`);
    assert.equal(await waitForCloseCode(malformedMac), 1008, 'malformed %25 MAC rejected with 1008');

    // Server must still be alive and functional afterwards (regression guard).
    const healthAfter = await fetch(`${baseHttp}/api/health`);
    assert.equal(healthAfter.status, 200, 'server survives malformed WebSocket MAC');

    const badEscape = new WebSocket(`${baseWs}/ws/agent?mac=%ZZ&token=x`);
    assert.equal(await waitForCloseCode(badEscape), 1008, 'malformed %ZZ MAC rejected with 1008');
    console.log('Malformed MAC WebSocket crash regression passed');
  }

  // --- Rate limiting: repeated failed PIN attempts lock the source IP ---
  {
    const oldMax = process.env.LOGIN_MAX_ATTEMPTS;
    const oldLock = process.env.LOGIN_LOCKOUT_MS;
    process.env.LOGIN_MAX_ATTEMPTS = '3';
    process.env.LOGIN_LOCKOUT_MS = '600';

    try {
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`${baseHttp}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: '000000' }),
        });
        assert.equal(r.status, 401, `failed attempt #${i + 1} returns 401`);
      }

      // While locked out even the correct PIN must be rejected with 429.
      const locked = await fetch(`${baseHttp}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '888888' }),
      });
      assert.equal(locked.status, 429, 'login rejected with 429 while locked out');
      console.log('Login rate-limit lockout test passed');
    } finally {
      if (oldMax === undefined) delete process.env.LOGIN_MAX_ATTEMPTS;
      else process.env.LOGIN_MAX_ATTEMPTS = oldMax;
      if (oldLock === undefined) delete process.env.LOGIN_LOCKOUT_MS;
      else process.env.LOGIN_LOCKOUT_MS = oldLock;
    }
  }

  // --- CORS allowlist: unknown origins get no CORS headers ---
  {
    const evil = await fetch(`${baseHttp}/api/health`, { headers: { Origin: 'http://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null, 'unknown origin gets no CORS header');

    const allowed = await fetch(`${baseHttp}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173', 'allowlisted origin gets CORS header');
    console.log('CORS allowlist test passed');
  }

  console.log('WebSocket and snapshot authentication integration tests passed');
} finally {
  if (viewer && viewer.readyState < WebSocket.CLOSING) viewer.close();
  if (agent && agent.readyState < WebSocket.CLOSING) agent.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
