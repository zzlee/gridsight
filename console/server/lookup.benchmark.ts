import { MulticastDiscoveryService } from './multicastDiscovery.js';
import type { DiscoveredAgent } from './multicastDiscovery.js';
import { TokenAuthority } from './tokenAuthority.js';

const tokenAuth = new TokenAuthority();
const service = new MulticastDiscoveryService(tokenAuth);

// Access private activeDevices map using casting for benchmark setup
const activeDevices = (service as any).activeDevices as Map<string, DiscoveredAgent>;
const indexDevice = (service as any).indexDevice.bind(service);

const NUM_DEVICES = 1000;
const now = Date.now();

for (let i = 0; i < NUM_DEVICES; i++) {
  const mac = `00:11:22:33:44:${i.toString(16).padStart(2, '0').toUpperCase()}`;
  const ip = `192.168.1.${(i % 254) + 1}`;
  const hostname = `STUDENT-PC-${i}`;
  const agent: DiscoveredAgent = {
    id: mac,
    hostname,
    ip,
    mac,
    username: 'Student',
    token: 'test-token',
    activeWindow: 'Desktop',
    lastSeen: now,
  };
  activeDevices.set(mac, agent);
  indexDevice(agent);
}

const testTargets = [
  '00:11:22:33:44:00',
  '00:11:22:33:44:1F',
  '00:11:22:33:44:FF',
  '00:11:22:33:44:3E7',
  '192.168.1.50',
  'STUDENT-PC-999',
  'NON_EXISTENT_TARGET',
];

const ITERATIONS = 10000;

console.log(`Running optimized O(1) benchmark with ${NUM_DEVICES} devices, ${ITERATIONS} iterations per target...`);

const startTime = process.hrtime.bigint();

for (let iter = 0; iter < ITERATIONS; iter++) {
  for (const rawId of testTargets) {
    // O(1) device lookup via findDevice
    const dev = service.findDevice(rawId);
  }
}

const endTime = process.hrtime.bigint();
const totalTimeMs = Number(endTime - startTime) / 1_000_000;

console.log(`[Optimized Benchmark] Total time: ${totalTimeMs.toFixed(2)} ms`);
console.log(`[Optimized Benchmark] Avg time per lookup batch: ${(totalTimeMs / ITERATIONS).toFixed(4)} ms`);
