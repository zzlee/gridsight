import os from 'os';
import readline from 'readline';

export interface NicInfo {
  name: string;
  ip: string;
  mac: string;
  isVirtual: boolean;
  isRecommended: boolean;
}

/**
 * Detect all available IPv4 network interfaces on the local machine
 */
export function detectNetworkInterfaces(): NicInfo[] {
  const interfaces = os.networkInterfaces();
  const list: NicInfo[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const lowerName = name.toLowerCase();
        const isVirtual =
          lowerName.includes('vethernet') ||
          lowerName.includes('wsl') ||
          lowerName.includes('virtualbox') ||
          lowerName.includes('vmware') ||
          lowerName.includes('zerotier') ||
          lowerName.includes('tailscale') ||
          lowerName.includes('docker') ||
          lowerName.includes('loopback') ||
          lowerName.includes('npcap');

        // Prioritize common classroom subnets & physical adapters
        const isRecommended =
          !isVirtual &&
          (lowerName.includes('eth') ||
            lowerName.includes('lan') ||
            lowerName.includes('以太') ||
            lowerName.includes('乙太') ||
            lowerName.includes('區域連線') ||
            lowerName.includes('wi-fi') ||
            lowerName.includes('wlan') ||
            lowerName.includes('無線') ||
            addr.address.startsWith('192.168.') ||
            addr.address.startsWith('10.'));

        list.push({
          name,
          ip: addr.address,
          mac: addr.mac,
          isVirtual,
          isRecommended,
        });
      }
    }
  }

  // Sort so recommended physical NICs appear first
  list.sort((a, b) => {
    if (a.isRecommended && !b.isRecommended) return -1;
    if (!a.isRecommended && b.isRecommended) return 1;
    if (!a.isVirtual && b.isVirtual) return -1;
    if (a.isVirtual && !b.isVirtual) return 1;
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Interactively prompt the teacher to select a network adapter if multiple are detected
 */
export async function promptSelectNic(timeoutSec = 6): Promise<{ host: string; ip: string; nicName: string }> {
  const nics = detectNetworkInterfaces();

  // If environment variable explicitly sets TEACHER_IP or HOST, use it
  if (process.env.TEACHER_IP) {
    const found = nics.find((n) => n.ip === process.env.TEACHER_IP);
    return {
      host: '0.0.0.0',
      ip: process.env.TEACHER_IP,
      nicName: found ? found.name : 'Manual Config',
    };
  }

  // If 0 interfaces found (offline/standalone loopback)
  if (nics.length === 0) {
    return { host: '0.0.0.0', ip: '127.0.0.1', nicName: 'Loopback' };
  }

  // If only 1 interface found, auto-select
  if (nics.length === 1) {
    const only = nics[0]!;
    console.log(`[Network] 偵測到單一網路介面: ${only.name} (${only.ip})，已自動選定。`);
    return { host: '0.0.0.0', ip: only.ip, nicName: only.name };
  }

  // If non-interactive (Docker, background daemon, or --no-prompt)
  if (!process.stdin.isTTY || process.argv.includes('--no-prompt')) {
    const best = nics[0]!;
    console.log(`[Network] 非互動環境，已自動選定主要網卡: ${best.name} (${best.ip})`);
    return { host: '0.0.0.0', ip: best.ip, nicName: best.name };
  }

  // Multi-NIC Interactive Terminal Selection Menu
  console.log('\n===============================================================');
  console.log('  🌐 GridSight 伺服器啟動 - 偵測到多張網路卡 (Multi-NIC)');
  console.log('===============================================================');
  nics.forEach((nic, idx) => {
    const tag = idx === 0 ? ' ⭐ [推薦/預設]' : nic.isVirtual ? ' (虛擬網卡)' : '';
    console.log(`  [${idx + 1}] ${nic.name.padEnd(22)} -> ${nic.ip.padEnd(16)} ${tag}`);
  });
  console.log(`  [0] 全部網卡同時監聽 (0.0.0.0)`);
  console.log('---------------------------------------------------------------');

  return new Promise((resolve) => {
    let remaining = timeoutSec;
    let timer: NodeJS.Timeout | null = null;
    let resolved = false;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const finalize = (choice: number) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearInterval(timer);
      rl.close();

      if (choice === 0) {
        console.log(`\n  ✅ 已選擇: 全部網卡 (0.0.0.0) - 學生端連線預設使用 ${nics[0]!.ip}\n`);
        resolve({ host: '0.0.0.0', ip: nics[0]!.ip, nicName: '全部網卡 (0.0.0.0)' });
      } else {
        const selected = nics[choice - 1] || nics[0]!;
        console.log(`\n  ✅ 已選定網卡: [${selected.name}] -> ${selected.ip}\n`);
        resolve({ host: '0.0.0.0', ip: selected.ip, nicName: selected.name });
      }
    };

    process.stdout.write(`請輸入欲提供學生連線的網卡編號 [1-${nics.length}, 0] (倒數 ${remaining} 秒自動選擇 1): `);

    timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`\n⏰ 倒數結束，自動選定預設網卡 [1] ${nics[0]!.name} (${nics[0]!.ip})\n`);
        finalize(1);
      } else {
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`請輸入欲提供學生連線的網卡編號 [1-${nics.length}, 0] (倒數 ${remaining} 秒自動選擇 1): `);
      }
    }, 1000);

    rl.on('line', (line) => {
      const input = line.trim();
      if (input === '') {
        finalize(1);
      } else {
        const num = parseInt(input, 10);
        if (!isNaN(num) && num >= 0 && num <= nics.length) {
          finalize(num);
        } else {
          console.log(`\n輸入無效，將使用預設網卡 [1] ${nics[0]!.name} (${nics[0]!.ip})`);
          finalize(1);
        }
      }
    });
  });
}
