import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { TokenAuthority } from './tokenAuthority.js';
import { MulticastDiscoveryService } from './multicastDiscovery.js';
import { TeacherBroadcastStreamer } from './broadcastStreamer.js';
import { logger } from './logger.js';

const currentDirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url || 'file:///'));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.API_PORT || process.env.PORT ? parseInt(process.env.API_PORT || process.env.PORT || '3000', 10) : 3000;
const HOST = process.env.API_HOST || '0.0.0.0';

app.use(cors());
app.use(express.json());

const tokenAuth = new TokenAuthority();
const broadcastStreamer = new TeacherBroadcastStreamer();
const discoveryService = new MulticastDiscoveryService(tokenAuth, (device) => {
  logger.info(`[Discovery] New Beacon: ${device.hostname} (${device.ip})`);
});

discoveryService.start();

// Teacher PIN authentication state
let teacherPin = process.env.TEACHER_PIN || '888888';
const teacherSessions = new Map<string, number>(); // token -> expiresAt

const generateTeacherToken = () => {
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36) + Math.random().toString(36).substring(2);
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days valid
  teacherSessions.set(token, expiresAt);
  return { token, expiresAt };
};

const isValidTeacherToken = (token: string | null | undefined): boolean => {
  if (!token) return false;
  const expiresAt = teacherSessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    teacherSessions.delete(token);
    return false;
  }
  return true;
};

// Middleware: Protect teacher control & discovery routes from unauthorized student browsers
const requireTeacherAuth: express.RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token as string);
  if (isValidTeacherToken(token)) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized: Teacher PIN required', code: 'AUTH_REQUIRED' });
};

// In-memory JPEG snapshot cache for outbound student pushes
const snapshotCache = new Map<string, { buffer: Buffer; timestamp: number }>();

// Maps for WebSocket reverse relay
const agentSockets = new Map<string, WebSocket>();
const viewerSockets = new Map<string, Set<WebSocket>>();

// Normalizes MAC addresses and targets by decoding URL characters and standardizing case
const normalizeTarget = (raw: string) => {
  if (!raw) return '';
  return decodeURIComponent(raw).replace(/%3A/gi, ':').trim().toUpperCase();
};

wss.on('connection', (ws, req) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const parsedUrl = new URL(req.url || '', `http://${host}`);
  const pathname = parsedUrl.pathname;

  if (pathname === '/ws/agent') {
    const rawMac = parsedUrl.searchParams.get('mac') || req.socket.remoteAddress?.replace(/^.*:/, '') || 'unknown';
    const mac = normalizeTarget(rawMac);
    agentSockets.set(mac, ws);
    logger.info(`[WS Relay] Student Agent registered outbound: ${mac}`);

    let frameCount = 0;
    let totalBytes = 0;

    ws.on('message', (data, isBinary) => {
      frameCount++;
      const len = (data as Buffer)?.length || 0;
      totalBytes += len;

      if (frameCount === 1 || frameCount % 60 === 0) {
        logger.info(`[WS Relay] Agent ${mac} sent ${isBinary ? 'BINARY H.264' : 'TEXT'} frame #${frameCount} (${len} bytes, total ${Math.round(totalBytes / 1024)} KB). Relaying to ${viewerSockets.get(mac)?.size || 0} viewers`);
      }

      if (isBinary) {
        // Forward H.264 video NALU frames directly to active teacher viewers
        const viewers = viewerSockets.get(mac);
        if (viewers && viewers.size > 0) {
          viewers.forEach((v) => {
            if (v.readyState === WebSocket.OPEN) {
              v.send(data, { binary: true });
            }
          });
        }
      }
    });

    ws.on('close', () => {
      agentSockets.delete(mac);
      logger.info(`[WS Relay] Student Agent disconnected: ${mac}`);
    });
  } else if (pathname.startsWith('/ws/stream/')) {
    const rawTarget = pathname.replace('/ws/stream/', '');
    let mac = normalizeTarget(rawTarget);

    // Smart resolution: resolve IP, hostname, or ID to actual connected agent MAC
    if (!agentSockets.has(mac)) {
      const dev = discoveryService.getDevices().find(
        (d) => d.mac === mac || d.ip === mac || d.id === mac || d.hostname === mac || normalizeTarget(d.mac) === mac
      );
      if (dev && agentSockets.has(normalizeTarget(dev.mac))) {
        mac = normalizeTarget(dev.mac);
      } else if (agentSockets.size === 1) {
        mac = Array.from(agentSockets.keys())[0];
      }
    }

    if (!viewerSockets.has(mac)) {
      viewerSockets.set(mac, new Set());
    }
    viewerSockets.get(mac)!.add(ws);
    logger.info(`[WS Relay] Teacher Viewer opened stream for: ${mac} (total viewers: ${viewerSockets.get(mac)!.size})`);

    // Tell student agent to start H.264 30 FPS encoder
    const agentWs = agentSockets.get(mac);
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({ action: 'START_STREAM', fps: 30, bitrate: 2500 }));
      logger.info(`[WS Relay] Sent START_STREAM command to agent: ${mac}`);
    } else {
      logger.warn(`[WS Relay] Agent not found for target ${mac}. Available agents: [${Array.from(agentSockets.keys()).join(', ')}]`);
    }

    ws.on('close', () => {
      const viewers = viewerSockets.get(mac);
      if (viewers) {
        viewers.delete(ws);
        logger.info(`[WS Relay] Teacher Viewer closed stream for: ${mac} (remaining viewers: ${viewers.size})`);
        if (viewers.size === 0) {
          viewerSockets.delete(mac);
          // Tell student agent to stop streaming to save GPU/bandwidth
          const agentWs = agentSockets.get(mac);
          if (agentWs && agentWs.readyState === WebSocket.OPEN) {
            agentWs.send(JSON.stringify({ action: 'STOP_STREAM' }));
            logger.info(`[WS Relay] Sent STOP_STREAM command to agent: ${mac}`);
          }
        }
      }
    });
  }
});

// Auth Routes: Teacher PIN Login and Verification
app.post('/api/auth/login', (req, res) => {
  const { pin } = req.body;
  if (typeof pin === 'string' && pin.trim() === teacherPin.trim()) {
    const { token, expiresAt } = generateTeacherToken();
    logger.info(`[Auth] Teacher logged in successfully from IP: ${req.ip}`);
    res.json({ success: true, token, expiresAt });
  } else {
    logger.warn(`[Auth] Failed PIN attempt from IP: ${req.ip}`);
    res.status(401).json({ success: false, error: 'PIN 碼錯誤，請重新輸入' });
  }
});

app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token as string);
  res.json({ authenticated: isValidTeacherToken(token) });
});

app.post('/api/auth/change-pin', requireTeacherAuth, (req, res) => {
  const { currentPin, newPin } = req.body;
  if (currentPin !== teacherPin) {
    return res.status(400).json({ error: '原 PIN 碼不正確' });
  }
  if (!newPin || newPin.length < 4) {
    return res.status(400).json({ error: '新 PIN 碼至少需要 4 位數' });
  }
  teacherPin = newPin;
  logger.info(`[Auth] Teacher changed PIN successfully`);
  res.json({ success: true, message: 'PIN 碼已成功修改' });
});

app.get('/api/stream/debug', requireTeacherAuth, (req, res) => {
  res.json({
    connectedAgents: Array.from(agentSockets.keys()),
    activeViewers: Array.from(viewerSockets.entries()).map(([k, v]) => ({
      mac: k,
      viewerCount: v.size,
    })),
    discoveredAgents: discoveryService.getDevices().map((d) => ({
      id: d.id,
      mac: d.mac,
      ip: d.ip,
      hostname: d.hostname,
      status: d.status,
    })),
    serverTime: new Date().toISOString(),
  });
});

const isStandalone = (process as any).pkg !== undefined || process.platform === 'win32';
const defaultSeatsFile = isStandalone
  ? path.resolve(process.cwd(), 'data', 'seats.json')
  : '/data/seats.json';
const SEATS_FILE = process.env.SEATS_FILE || defaultSeatsFile;

const ensureSeatsDirectory = async () => {
  const dir = path.dirname(SEATS_FILE);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    logger.warn(`[Seats] Failed to create directory ${dir}: ${err}`);
  }
};

const DEFAULT_OFFTASK_KEYWORDS = [
  'YouTube', 'Bilibili', 'Roblox', 'Minecraft', 'Steam',
  'Discord', 'Twitch', '抖音', 'Tiktok', '巴哈姆特',
  '動畫瘋', 'Facebook', 'Instagram', 'Netflix', 'Game', '遊戲'
];

const getDefaultSeatsLayout = () => {
  const cols = 8;
  const rows = 6;
  return {
    id: `layout-matrix-${cols}x${rows}`,
    name: `電腦教室 (${cols}×${rows}, ${cols * rows}席位)`,
    cols: Math.max(cols, 4),
    rows,
    seats: [], // Clean empty matrix by default!
    aisles: [],
    obstacles: [],
    offTaskKeywords: DEFAULT_OFFTASK_KEYWORDS,
  };
};

const saveSeatsLayout = async (layoutData: any) => {
  await ensureSeatsDirectory();
  try {
    await fs.promises.writeFile(SEATS_FILE, JSON.stringify(layoutData, null, 2), 'utf-8');
    logger.info(`[Seats] Successfully saved layout to ${SEATS_FILE}`);
    return true;
  } catch (err) {
    logger.error(`[Seats] Failed to write layout to ${SEATS_FILE}: ${err}`);
    return false;
  }
};

const loadSeatsLayout = async () => {
  await ensureSeatsDirectory();
  try {
    const content = await fs.promises.readFile(SEATS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.seats)) {
      // Filter out legacy dummy offline seats
      const cleanedSeats = parsed.seats.filter(
        (s: any) =>
          !(
            s.status === 'offline' &&
            s.ip?.startsWith('192.168.1.') &&
            s.mac?.startsWith('00:1A:2B:3C')
          )
      );
      parsed.seats = cleanedSeats;
      if (!Array.isArray(parsed.offTaskKeywords)) {
        parsed.offTaskKeywords = DEFAULT_OFFTASK_KEYWORDS;
      }
      return parsed;
    }
  } catch (err) {
    logger.warn(`[Seats] Error reading ${SEATS_FILE}: ${err}`);
  }

  const defaultLayout = getDefaultSeatsLayout();
  await saveSeatsLayout(defaultLayout);
  return defaultLayout;
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now(), seatsFile: SEATS_FILE });
});

app.get('/api/layout', async (req, res) => {
  const layout = await loadSeatsLayout();
  res.json({ success: true, layout, file: SEATS_FILE });
});

app.post('/api/layout', requireTeacherAuth, async (req, res) => {
  const layout = req.body;
  if (!layout || !Array.isArray(layout.seats)) {
    return res.status(400).json({ success: false, error: 'Invalid layout structure' });
  }
  const saved = await saveSeatsLayout(layout);
  if (saved) {
    res.json({ success: true, message: 'Layout successfully saved to server', file: SEATS_FILE });
  } else {
    res.status(500).json({ success: false, error: 'Failed to write to seats file' });
  }
});

app.get('/api/agents', requireTeacherAuth, (req, res) => {
  res.json({
    agents: discoveryService.getDevices(),
    count: discoveryService.getDevices().length,
  });
});

app.get('/api/devices', requireTeacherAuth, (req, res) => {
  res.json({
    devices: discoveryService.getDevices(),
    count: discoveryService.getDevices().length,
  });
});

app.post('/api/broadcast/start', requireTeacherAuth, (req, res) => {
  broadcastStreamer.startStream(req.body);
  res.json({ status: 'streaming', active: true });
});

app.post('/api/broadcast/stop', requireTeacherAuth, (req, res) => {
  broadcastStreamer.stopStream();
  res.json({ status: 'stopped', active: false });
});

app.get('/api/broadcast/status', requireTeacherAuth, (req, res) => {
  res.json({ active: broadcastStreamer.isActive() });
});

// Route: Receive outbound JPEG snapshots pushed from student agents (100% firewall proof)
app.post(
  '/api/agent/snapshot',
  express.raw({ type: ['image/jpeg', 'application/octet-stream', '*/*'], limit: '2mb' }),
  (req, res) => {
    const rawMac = (req.headers['x-agent-mac'] as string) || '';
    const ip = (req.headers['x-agent-ip'] as string) || req.ip?.replace(/^.*:/, '') || '';
    const rawWin = (req.headers['x-active-window'] as string) || '';
    const mac = normalizeTarget(rawMac);
    const buffer = req.body as Buffer;

    if (rawWin) {
      try {
        const winTitle = Buffer.from(rawWin, 'base64').toString('utf-8');
        const dev = discoveryService.getDevices().find((d) => normalizeTarget(d.mac) === mac || d.ip === ip);
        if (dev && winTitle) {
          dev.activeWindow = winTitle;
        }
      } catch {}
    }

    if (buffer && buffer.length > 0) {
      if (mac) snapshotCache.set(mac, { buffer, timestamp: Date.now() });
      if (ip) snapshotCache.set(ip, { buffer, timestamp: Date.now() });
      res.status(200).json({ status: 'ok' });
    } else {
      res.status(400).json({ error: 'empty snapshot' });
    }
  }
);

// Route: Serve cached JPEG snapshots to Teacher Browser UI (with on-demand proxy fallback)
app.get(['/api/snapshot/:id', '/api/snapshot'], async (req, res) => {
  const rawId = req.params.id || (req.query.id as string) || (req.query.mac as string) || (req.query.ip as string) || '';
  const normalizedId = normalizeTarget(rawId);
  let cachedEntry = snapshotCache.get(normalizedId) || snapshotCache.get(rawId);

  // If not in cache or older than 3 seconds, perform fast on-demand proxy fetch from agent port
  if (!cachedEntry || Date.now() - cachedEntry.timestamp >= 3000) {
    const dev = discoveryService.getDevices().find(
      (d) => normalizeTarget(d.mac) === normalizedId || d.ip === rawId || d.hostname === rawId
    );
    if (dev && dev.ip) {
      const port = dev.port || 8080;
      try {
        const agentUrl = `http://${dev.ip}:${port}/snapshot`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1200);
        const resp = await fetch(agentUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          const buffer = Buffer.from(ab);
          cachedEntry = { buffer, timestamp: Date.now() };
          snapshotCache.set(normalizedId, cachedEntry);
          if (dev.mac) snapshotCache.set(normalizeTarget(dev.mac), cachedEntry);
          if (dev.ip) snapshotCache.set(dev.ip, cachedEntry);
        }
      } catch {
        // Fall through to existing cache if available
      }
    }
  }

  // Graceful return from snapshot cache
  if (cachedEntry) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(cachedEntry.buffer);
  }

  res.status(404).json({ error: 'No snapshot available' });
});

// Route: One-click PowerShell installation script for Student PCs
app.get('/install-agent.ps1', (req, res) => {
  const host = req.headers.host || `${req.hostname}:${PORT}`;
  const script = `# ========================================================
# GridSight Agent One-Click Pull & Launch Script (v5.3.3)
# ========================================================
$ErrorActionPreference = "SilentlyContinue"
$serverHost = "${host}"
$exeUrl = "http://$serverHost/download/gs-agent.exe"
$destDir = "$env:TEMP"
$destPath = "$destDir\\gs-agent.exe"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  GridSight Student Agent v5.3.3 部署與啟動程序" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "[GridSight] 正在終止舊版 gs-agent 行程..." -ForegroundColor Yellow

# Kill all previous gs-agent instances completely
taskkill /F /IM gs-agent.exe /T 2>$null | Out-Null
Start-Sleep -Milliseconds 500

Write-Host "[GridSight] 正在從 $exeUrl 下載最新版 gs-agent.exe..." -ForegroundColor Cyan
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
Invoke-WebRequest -Uri $exeUrl -OutFile $destPath -UseBasicParsing

# Configure Firewall
try {
    netsh advfirewall firewall delete rule name="GridSight Agent" 2>$null | Out-Null
    netsh advfirewall firewall delete rule name="GridSight Agent Out" 2>$null | Out-Null
    netsh advfirewall firewall add rule name="GridSight Agent" dir=in action=allow program="$destPath" enable=yes profile=any protocol=any 2>$null | Out-Null
    netsh advfirewall firewall add rule name="GridSight Agent Out" dir=out action=allow program="$destPath" enable=yes profile=any protocol=any 2>$null | Out-Null
} catch {}

Write-Host "[GridSight] 正在啟動最新版 gs-agent.exe (v5.3.3)..." -ForegroundColor Green
Start-Process -FilePath $destPath -WindowStyle Hidden

Start-Sleep -Seconds 1
$proc = Get-Process -Name "gs-agent" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "[GridSight] ✅ 學生端代理程式 (v5.3.3) 已成功在背景啟動！ (PID: $($proc[0].Id))" -ForegroundColor Green
} else {
    Write-Host "[GridSight] ⚠️ 警告：無法確認背景行程狀態，請檢查防毒軟體或權限設定。" -ForegroundColor Yellow
}
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(script);
});

// Route: One-click Stop gs-agent PowerShell script
app.get('/stop-agent.ps1', (req, res) => {
  const script = `# ========================================================
# GridSight Student Agent Stop Script
# ========================================================
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  GridSight 學生端代理程式 (gs-agent) 停止程序" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$proc = Get-Process -Name "gs-agent" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "[GridSight] 正在終止背景 gs-agent 行程 (PID: $($proc.Id -join ', '))..." -ForegroundColor Yellow
    taskkill /F /IM gs-agent.exe /T 2>$null | Out-Null
    Stop-Process -Name "gs-agent" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Write-Host "[GridSight] ✅ 學生端代理程式 (gs-agent) 已成功停止！" -ForegroundColor Green
} else {
    Write-Host "[GridSight] ℹ️ 未檢測到正在運行的 gs-agent 行程。" -ForegroundColor DarkGray
}
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(script);
});

// Route: One-click Mock 70-Agent Cluster PowerShell script
app.get('/mock-agent.ps1', (req, res) => {
  const host = req.headers.host || `${req.hostname}:${PORT}`;
  const teacherIp = host.split(':')[0];
  const count = req.query.count || '70';
  const script = `# ========================================================
# GridSight Mock 70+ Agents One-Click Launcher
# ========================================================
$ErrorActionPreference = "SilentlyContinue"
$serverHost = "${host}"
$teacherIp = "${teacherIp}"
$mockCount = ${count}
$scriptUrl = "http://$serverHost/mock_agents.py"
$destPath = "$env:TEMP\\gridsight_mock_agents.py"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  GridSight Mock 70+ Agent 叢集一鍵啟動程序" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# Check Python installation
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
    Write-Host "[Error] 找不到 Python 環境！請先至 https://www.python.org 下載安裝 Python。" -ForegroundColor Red
    return
}

# Install pillow for realistic screen generation
Write-Host "[GridSight] 檢查影像處理套件 (Pillow)..." -ForegroundColor Yellow
pip install pillow --quiet 2>$null | Out-Null

Write-Host "[GridSight] 正在從 $scriptUrl 下載 Mock Agent 程式碼..." -ForegroundColor Cyan
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
Invoke-WebRequest -Uri $scriptUrl -OutFile $destPath -UseBasicParsing

Write-Host "[GridSight] 🚀 正在啟動 $mockCount 路模擬學生端 (對象教師端: $teacherIp)..." -ForegroundColor Green
Write-Host "[GridSight] 提示：按下 Ctrl + C 即可隨時停止模擬叢集。" -ForegroundColor DarkGray
Write-Host ""

# Run Python mock agents directly in the current terminal window
python $destPath --count $mockCount --teacher-ip $teacherIp
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(script);
});

// Route: Serve mock_agents.py file
const possibleMockScriptPaths = [
  path.resolve(currentDirname, '../../tools/mock_agents.py'),
  path.resolve(currentDirname, '../tools/mock_agents.py'),
  path.resolve(currentDirname, 'tools/mock_agents.py'),
  path.resolve(process.cwd(), 'tools/mock_agents.py'),
  '/app/tools/mock_agents.py',
];

const getMockScriptPath = () => {
  for (const p of possibleMockScriptPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

app.get(['/mock_agents.py', '/tools/mock_agents.py'], (req, res) => {
  const scriptPath = getMockScriptPath();
  if (scriptPath) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(scriptPath);
  } else {
    res.status(404).send('# Error: mock_agents.py not found on server');
  }
});

// Route: Serve gs-agent.exe binary download
const possibleAgentPaths = [
  path.resolve(currentDirname, '../../beacon/gs-agent.exe'),
  path.resolve(currentDirname, '../downloads/gs-agent.exe'),
  path.resolve(currentDirname, 'beacon/gs-agent.exe'),
  path.resolve(currentDirname, 'gs-agent.exe'),
  path.resolve(process.cwd(), 'gs-agent.exe'),
  path.resolve(process.cwd(), 'beacon/gs-agent.exe'),
  '/app/downloads/gs-agent.exe',
  '/app/beacon/gs-agent.exe',
];

const getAgentBinaryPath = () => {
  for (const p of possibleAgentPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

app.get(['/download/gs-agent.exe', '/gs-agent.exe'], (req, res) => {
  const binaryPath = getAgentBinaryPath();
  if (binaryPath) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="gs-agent.exe"');
    res.sendFile(binaryPath);
  } else {
    res.status(404).json({ error: 'gs-agent.exe not found on server. Please run ./scripts/build-docker.sh first.' });
  }
});

// Route: Serve gs-console.exe Windows Standalone binary download
const possibleConsolePaths = [
  path.resolve(currentDirname, '../../release/gs-console.exe'),
  path.resolve(currentDirname, '../release/gs-console.exe'),
  path.resolve(currentDirname, 'release/gs-console.exe'),
  path.resolve(currentDirname, 'gs-console.exe'),
  path.resolve(process.cwd(), 'release/gs-console.exe'),
  path.resolve(process.cwd(), 'gs-console.exe'),
  '/app/release/gs-console.exe',
  '/app/downloads/gs-console.exe',
];

const getConsoleBinaryPath = () => {
  for (const p of possibleConsolePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

app.get(['/download/gs-console.exe', '/gs-console.exe'], (req, res) => {
  const binaryPath = getConsoleBinaryPath();
  if (binaryPath) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="gs-console.exe"');
    res.sendFile(binaryPath);
  } else {
    res.status(404).json({ error: 'gs-console.exe not found on server. Please run npm run build:windows first.' });
  }
});

// Route: Serve gridsight-console-portable.zip download
const possiblePortablePaths = [
  path.resolve(currentDirname, '../../release/gridsight-console-portable.zip'),
  path.resolve(currentDirname, '../release/gridsight-console-portable.zip'),
  path.resolve(currentDirname, 'release/gridsight-console-portable.zip'),
  path.resolve(currentDirname, 'gridsight-console-portable.zip'),
  path.resolve(process.cwd(), 'release/gridsight-console-portable.zip'),
  path.resolve(process.cwd(), 'gridsight-console-portable.zip'),
  '/app/release/gridsight-console-portable.zip',
  '/app/downloads/gridsight-console-portable.zip',
];

const getPortableZipPath = () => {
  for (const p of possiblePortablePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

app.get(['/download/gridsight-console-portable.zip', '/download/console-portable.zip'], (req, res) => {
  const zipPath = getPortableZipPath();
  if (zipPath) {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="gridsight-console-portable.zip"');
    res.sendFile(zipPath);
  } else {
    res.status(404).json({ error: 'gridsight-console-portable.zip not found on server. Please run npm run build:portable first.' });
  }
});

// Serve frontend dist assets if present
const candidateDistPaths = [
  process.env.STATIC_DIR,
  path.resolve(currentDirname, '../dist'),
  path.resolve(currentDirname, 'dist'),
  path.resolve(process.cwd(), 'dist'),
  '/app/console/dist',
  '/app/dist',
];

let staticDistPath = '';
for (const p of candidateDistPaths) {
  if (p && fs.existsSync(p)) {
    staticDistPath = p;
    break;
  }
}

if (staticDistPath) {
  app.use(express.static(staticDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/install-agent.ps1' || req.path.startsWith('/download/')) return next();
    res.sendFile(path.join(staticDistPath, 'index.html'));
  });
  logger.info(`[GridSight Server] Serving web console UI from ${staticDistPath}`);
}

server.listen(PORT, HOST, () => {
  const localUrl = `http://localhost:${PORT}`;
  logger.info(`=============================================================`);
  logger.info(`  GridSight Teacher Console v5.3.3`);
  logger.info(`  Web Console UI: ${localUrl}`);
  logger.info(`  Multicast Beacon Discovery: 239.255.42.99:8888`);
  logger.info(`=============================================================`);

  if (process.platform === 'win32' && !process.argv.includes('--no-open')) {
    import('child_process').then(({ exec }) => {
      exec(`start ${localUrl}`);
    }).catch(() => {});
  }
});
