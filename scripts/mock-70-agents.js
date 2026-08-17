#!/usr/bin/env node

/**
 * GridSight - 70 Mock Agents for Load Simulation
 * Simulates 70 agents binding to 127.0.0.1 - 127.0.0.70 on port 8080.
 * Broadcasts UDP beacons to the Multicast group so the Teacher Console can discover them.
 */

const dgram = require('dgram');
const http = require('http');

const NUM_AGENTS = 70;
const MULTICAST_GROUP = '239.255.42.99';
const DISCOVERY_PORT = 9001;
const SNAPSHOT_PORT = 8080;

// A tiny valid 1x1 PNG image in base64
const MOCK_IMAGE_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

console.log(`[Mock Agents] Starting ${NUM_AGENTS} Mock Agents...`);

const agents = [];

for (let i = 1; i <= NUM_AGENTS; i++) {
  const ip = `127.0.0.${i}`;
  const mac = `00:1A:2B:3C:4D:${i.toString(16).padStart(2, '0').toUpperCase()}`;
  const hostname = `PC-${i.toString().padStart(2, '0')}`;

  // Start HTTP Server for each mock agent to serve /snapshot
  const server = http.createServer((req, res) => {
    // Basic CORS headers just in case
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url.startsWith('/snapshot')) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': MOCK_IMAGE_BUFFER.length,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(MOCK_IMAGE_BUFFER);
    } else if (req.url.startsWith('/status') || req.url.startsWith('/api/status')) {
      const cpuUsage = Math.round((10 + Math.random() * 25) * 10) / 10;
      const ramUsage = Math.round((25 + (i % 30) + Math.random() * 5) * 10) / 10;
      const statusPayload = JSON.stringify({
        status: 'ok',
        service: 'GridSight Beacon',
        hostname,
        os: 'Windows 11 Pro (x64)',
        uptime: 7200 + i * 60,
        cpu: {
          model: '12th Gen Intel(R) Core(TM) i5-12400',
          cores: 12,
          usage_percent: cpuUsage
        },
        ram: {
          total_mb: 16384,
          avail_mb: Math.round(16384 * (1 - ramUsage / 100)),
          usage_percent: ramUsage
        },
        disk: {
          drive: 'C:',
          total_gb: 512,
          free_gb: 320 - (i % 50),
          usage_percent: Math.round(((192 + (i % 50)) / 512) * 1000) / 10
        }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(statusPayload);
    } else if (req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'GridSight Beacon' }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.on('error', (err) => {
    console.error(`[Mock ${hostname}] HTTP Server Error on ${ip}:${SNAPSHOT_PORT} - ${err.message}`);
  });

  server.listen(SNAPSHOT_PORT, ip, () => {
    // console.log(`[Mock ${hostname}] HTTP Server listening on ${ip}:${SNAPSHOT_PORT}`);
  });

  agents.push({ ip, mac, hostname, server, username: `Student${i.toString().padStart(2, '0')}` });
}

sock.bind(() => {
  try {
    sock.setMulticastTTL(2);
  } catch (err) {
    console.warn(`[Mock Agents] Warning: Failed to set Multicast TTL. Continuing anyway...`);
  }

  // Start broadcasting beacons
  const sendBeacons = () => {
    agents.forEach((agent) => {
      const payload = JSON.stringify({
        type: "BEACON",
        hostname: agent.hostname,
        ip: agent.ip,
        mac: agent.mac,
        username: agent.username,
        timestamp: Date.now()
      });

      sock.send(payload, DISCOVERY_PORT, MULTICAST_GROUP, (err) => {
          if (err) {
             // Avoid spamming too many errors if network is unreachable
             // console.error(`Error sending beacon for ${agent.hostname}:`, err.message);
          }
      });
    });
  };

  // Initial burst, then periodic
  sendBeacons();
  setInterval(sendBeacons, 3000 + Math.random() * 2000);
  console.log(`[Mock Agents] Broadcasting beacons to ${MULTICAST_GROUP}:${DISCOVERY_PORT}`);
});

sock.on('error', (err) => {
    console.error(`[Mock Agents] UDP Socket Error:`, err);
});

process.on('SIGINT', () => {
  console.log('\n[Mock Agents] Shutting down mock agents...');
  agents.forEach(a => a.server.close());
  sock.close();
  process.exit(0);
});
