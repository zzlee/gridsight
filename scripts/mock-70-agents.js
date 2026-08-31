#!/usr/bin/env node

/**
 * GridSight - 70 Mock Agents for Load Simulation
 * Simulates 70 agents pushing snapshots and sending UDP beacons to the Multicast group so the Teacher Console can discover them.
 */

const dgram = require('dgram');

const NUM_AGENTS = 70;
const MULTICAST_GROUP = '239.255.42.99';
const DISCOVERY_PORT = 8888;

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

console.log(`[Mock Agents] Starting ${NUM_AGENTS} Mock Agents...`);

const agents = [];

for (let i = 1; i <= NUM_AGENTS; i++) {
  const ip = `127.0.0.${i}`;
  const mac = `00:1A:2B:3C:4D:${i.toString(16).padStart(2, '0').toUpperCase()}`;
  const hostname = `PC-${i.toString().padStart(2, '0')}`;

  agents.push({ ip, mac, hostname, username: `Student${i.toString().padStart(2, '0')}` });
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
  sock.close();
  process.exit(0);
});
