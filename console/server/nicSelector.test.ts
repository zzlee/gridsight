import os from 'os';
import { detectNetworkInterfaces, promptSelectNic } from './nicSelector.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log('Running nicSelector tests...\n');

// Store original os.networkInterfaces implementation
const originalNetworkInterfaces = os.networkInterfaces;
const originalEnvTeacherIp = process.env.TEACHER_IP;
const originalIsTTY = process.stdin.isTTY;

function setMockInterfaces(mockData: ReturnType<typeof os.networkInterfaces>) {
  os.networkInterfaces = () => mockData;
}

function restoreMocks() {
  os.networkInterfaces = originalNetworkInterfaces;
  if (originalEnvTeacherIp === undefined) {
    delete process.env.TEACHER_IP;
  } else {
    process.env.TEACHER_IP = originalEnvTeacherIp;
  }
  process.stdin.isTTY = originalIsTTY;
}

try {
  // 1. Empty network interfaces map
  setMockInterfaces({});
  let result = detectNetworkInterfaces();
  assert(Array.isArray(result) && result.length === 0, 'detectNetworkInterfaces returns empty array when no interfaces exist');

  // 2. Filter IPv6 and internal IPv4 interfaces
  setMockInterfaces({
    lo: [
      { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' },
      { address: '::1', netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', family: 'IPv6', mac: '00:00:00:00:00:00', internal: true, cidr: '::1/128' },
    ],
    eth0: [
      { address: 'fe80::1234', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '11:22:33:44:55:66', internal: false, cidr: 'fe80::1234/64' },
      { address: '192.168.1.10', netmask: '255.255.255.0', family: 'IPv4', mac: '11:22:33:44:55:66', internal: false, cidr: '192.168.1.10/24' },
    ],
  });

  result = detectNetworkInterfaces();
  assert(result.length === 1, 'Filters out IPv6 and internal IPv4 interfaces');
  assert(result[0].name === 'eth0' && result[0].ip === '192.168.1.10', 'Correctly captures external IPv4 interface details');

  // 3. Virtual interfaces detection
  const virtualNames = [
    'vEthernet (WSL)',
    'wsl-adapter',
    'VirtualBox Host-Only Network',
    'VMware Network Adapter VMnet1',
    'ZeroTier One',
    'Tailscale',
    'Docker0',
    'Loopback Pseudo-Interface 1',
    'Npcap Loopback Adapter',
  ];

  const mockVirtuals: ReturnType<typeof os.networkInterfaces> = {};
  virtualNames.forEach((name, idx) => {
    mockVirtuals[name] = [
      { address: `172.16.0.${idx + 1}`, netmask: '255.255.255.0', family: 'IPv4', mac: '00:11:22:33:44:55', internal: false, cidr: `172.16.0.${idx + 1}/24` },
    ];
  });

  setMockInterfaces(mockVirtuals);
  result = detectNetworkInterfaces();
  assert(result.length === virtualNames.length, 'Detects all virtual network interfaces');
  assert(result.every((n) => n.isVirtual === true), 'Sets isVirtual to true for virtual adapters');

  // 4. Physical / Recommended interfaces detection
  const physicalRecommendedCases = [
    { name: 'eth0', ip: '172.20.0.5' },
    { name: 'LAN Connection', ip: '172.20.0.6' },
    { name: '以太網', ip: '172.20.0.7' },
    { name: '乙太網路 2', ip: '172.20.0.8' },
    { name: '區域連線', ip: '172.20.0.9' },
    { name: 'Wi-Fi', ip: '172.20.0.10' },
    { name: 'wlan0', ip: '172.20.0.11' },
    { name: '無線網路', ip: '172.20.0.12' },
    { name: 'custom-nic', ip: '192.168.1.50' },
    { name: 'other-nic', ip: '10.0.0.50' },
  ];

  const mockPhysicals: ReturnType<typeof os.networkInterfaces> = {};
  physicalRecommendedCases.forEach((item) => {
    mockPhysicals[item.name] = [
      { address: item.ip, netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: `${item.ip}/24` },
    ];
  });

  setMockInterfaces(mockPhysicals);
  result = detectNetworkInterfaces();
  assert(result.length === physicalRecommendedCases.length, 'Detects all physical recommended interfaces');
  assert(result.every((n) => n.isRecommended === true && n.isVirtual === false), 'Sets isRecommended to true and isVirtual to false for physical/subnet matched interfaces');

  // 5. Sorting order test: Recommended Physical > Non-recommended Physical > Virtual, then alphabetical name sorting
  setMockInterfaces({
    'vEthernet (Default Switch)': [
      { address: '172.25.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '00:15:5d:01:02:03', internal: false, cidr: '172.25.0.1/16' },
    ],
    'alpha-virtual-docker': [
      { address: '172.17.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '02:42:01:02:03:04', internal: false, cidr: '172.17.0.1/16' },
    ],
    'zeta-other-subnet': [
      { address: '172.31.0.5', netmask: '255.255.0.0', family: 'IPv4', mac: '00:11:22:33:44:99', internal: false, cidr: '172.31.0.5/16' },
    ],
    'beta-other-subnet': [
      { address: '172.31.0.4', netmask: '255.255.0.0', family: 'IPv4', mac: '00:11:22:33:44:88', internal: false, cidr: '172.31.0.4/16' },
    ],
    'wlan0': [
      { address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: 'cc:dd:ee:ff:00:11', internal: false, cidr: '192.168.1.20/24' },
    ],
    'eth0': [
      { address: '10.0.0.10', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:00', internal: false, cidr: '10.0.0.10/24' },
    ],
  });

  result = detectNetworkInterfaces();
  const sortedNames = result.map((n) => n.name);
  // Expected order:
  // Recommended Physical (sorted alphabetically): eth0, wlan0
  // Non-recommended Physical (sorted alphabetically): beta-other-subnet, zeta-other-subnet
  // Virtual (sorted alphabetically): alpha-virtual-docker, vEthernet (Default Switch)
  const expectedOrder = [
    'eth0',
    'wlan0',
    'beta-other-subnet',
    'zeta-other-subnet',
    'alpha-virtual-docker',
    'vEthernet (Default Switch)',
  ];

  assert(JSON.stringify(sortedNames) === JSON.stringify(expectedOrder), 'Correctly sorts NICs: Recommended Physical -> Non-recommended Physical -> Virtual (alphabetical tie-breaking)');

  // 6. promptSelectNic tests
  // 6a. TEACHER_IP set and matches interface
  process.env.TEACHER_IP = '192.168.1.20';
  let promptRes = await promptSelectNic();
  assert(promptRes.host === '0.0.0.0' && promptRes.ip === '192.168.1.20' && promptRes.nicName === 'wlan0', 'promptSelectNic returns matched NIC when TEACHER_IP matches an existing IP');

  // 6b. TEACHER_IP set to custom/unmatched IP
  process.env.TEACHER_IP = '10.99.99.99';
  promptRes = await promptSelectNic();
  assert(promptRes.host === '0.0.0.0' && promptRes.ip === '10.99.99.99' && promptRes.nicName === 'Manual Config', 'promptSelectNic returns Manual Config when TEACHER_IP does not match any detected NIC');
  delete process.env.TEACHER_IP;

  // 6c. Zero interfaces found fallback
  setMockInterfaces({});
  promptRes = await promptSelectNic();
  assert(promptRes.host === '0.0.0.0' && promptRes.ip === '127.0.0.1' && promptRes.nicName === 'Loopback', 'promptSelectNic returns Loopback fallback when zero interfaces are found');

  // 6d. Single interface auto-select
  setMockInterfaces({
    eth0: [{ address: '192.168.1.100', netmask: '255.255.255.0', family: 'IPv4', mac: '11:22:33:44:55:66', internal: false, cidr: '192.168.1.100/24' }],
  });
  promptRes = await promptSelectNic();
  assert(promptRes.host === '0.0.0.0' && promptRes.ip === '192.168.1.100' && promptRes.nicName === 'eth0', 'promptSelectNic auto-selects single detected interface');

  // 6e. Non-interactive auto-select top interface
  setMockInterfaces({
    'vEthernet (WSL)': [{ address: '172.18.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '00:11:22:33:44:55', internal: false, cidr: '172.18.0.1/16' }],
    'eth0': [{ address: '192.168.1.50', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '192.168.1.50/24' }],
  });
  process.stdin.isTTY = false;
  promptRes = await promptSelectNic();
  assert(promptRes.host === '0.0.0.0' && promptRes.ip === '192.168.1.50' && promptRes.nicName === 'eth0', 'promptSelectNic auto-selects top-ranked NIC in non-interactive environment');

} finally {
  restoreMocks();
}

console.log('\nAll nicSelector tests passed successfully! 🎉');
