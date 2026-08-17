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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3001;
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

const SEATS_FILE = process.env.SEATS_FILE || '/data/seats.json';

const ensureSeatsDirectory = () => {
  const dir = path.dirname(SEATS_FILE);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      logger.warn(`[Seats] Failed to create directory ${dir}: ${err}`);
    }
  }
};

const getDefaultSeatsLayout = () => {
  const cols = 8;
  const rows = 6;
  const seats = [];
  let count = 1;

  for (let r = 0; r < rows; r++) {
    const rowLabel = String.fromCharCode(65 + (r % 26));
    for (let c = 0; c < cols; c++) {
      const seatNo = `${rowLabel}${c + 1}`;
      seats.push({
        id: `PC-${String(count).padStart(2, '0')}`,
        hostname: `PC-${String(count).padStart(2, '0')}`,
        ip: `192.168.1.${100 + count}`,
        mac: `00:1A:2B:3C:4D:${String(count).padStart(2, '0')}`,
        username: `Student${String(count).padStart(2, '0')}`,
        seatNo,
        gridX: c,
        gridY: r,
        status: 'offline',
        latencyMs: 0,
        lastSeen: 0,
      });
      count++;
    }
  }

  return {
    id: `layout-matrix-${cols}x${rows}`,
    name: `電腦教室 (${cols}×${rows}, ${cols * rows}台)`,
    cols: Math.max(cols, 4),
    rows,
    seats,
    aisles: [],
    obstacles: [],
  };
};

const saveSeatsLayout = (layoutData: any) => {
  ensureSeatsDirectory();
  try {
    fs.writeFileSync(SEATS_FILE, JSON.stringify(layoutData, null, 2), 'utf-8');
    logger.info(`[Seats] Successfully saved layout to ${SEATS_FILE}`);
    return true;
  } catch (err) {
    logger.error(`[Seats] Failed to write layout to ${SEATS_FILE}: ${err}`);
    return false;
  }
};

const loadSeatsLayout = () => {
  ensureSeatsDirectory();
  try {
    if (fs.existsSync(SEATS_FILE)) {
      const content = fs.readFileSync(SEATS_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.seats)) {
        const minGridY = Math.min(...parsed.seats.map((s: any) => s.gridY));
        if (minGridY === 1) {
          parsed.seats = parsed.seats.map((s: any) => ({ ...s, gridY: s.gridY - 1 }));
          parsed.rows = Math.max(...parsed.seats.map((s: any) => s.gridY)) + 1;
          parsed.obstacles = [];
          saveSeatsLayout(parsed);
        }
        return parsed;
      }
    }
  } catch (err) {
    logger.warn(`[Seats] Error reading ${SEATS_FILE}: ${err}`);
  }

  const defaultLayout = getDefaultSeatsLayout();
  saveSeatsLayout(defaultLayout);
  return defaultLayout;
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now(), seatsFile: SEATS_FILE });
});

app.get('/api/layout', (req, res) => {
  const layout = loadSeatsLayout();
  res.json({ success: true, layout, file: SEATS_FILE });
});

app.post('/api/layout', requireTeacherAuth, (req, res) => {
  const layout = req.body;
  if (!layout || !Array.isArray(layout.seats)) {
    return res.status(400).json({ success: false, error: 'Invalid layout structure' });
  }
  const saved = saveSeatsLayout(layout);
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
    const mac = normalizeTarget(rawMac);
    const buffer = req.body as Buffer;

    if (buffer && buffer.length > 0) {
      if (mac) snapshotCache.set(mac, { buffer, timestamp: Date.now() });
      if (ip) snapshotCache.set(ip, { buffer, timestamp: Date.now() });
      res.status(200).json({ status: 'ok' });
    } else {
      res.status(400).json({ error: 'empty snapshot' });
    }
  }
);

// Route: Serve cached JPEG snapshots to Teacher Browser UI
app.get(['/api/snapshot/:id', '/api/snapshot'], (req, res) => {
  const rawId = req.params.id || (req.query.id as string) || (req.query.mac as string) || (req.query.ip as string) || '';
  const normalizedId = normalizeTarget(rawId);
  const entry = snapshotCache.get(normalizedId) || snapshotCache.get(rawId);
  if (entry && Date.now() - entry.timestamp < 15000) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(entry.buffer);
  } else {
    res.status(404).json({ error: 'No snapshot available' });
  }
});

// Route: One-click PowerShell installation script for Student PCs
app.get('/install-agent.ps1', (req, res) => {
  const host = req.headers.host || `${req.hostname}:${PORT}`;
  const script = `# ========================================================
# GridSight Agent One-Click Pull & Launch Script (v5.3.0)
# ========================================================
$ErrorActionPreference = "SilentlyContinue"
$serverHost = "${host}"
$exeUrl = "http://$serverHost/download/gs-agent.exe"
$destDir = "$env:TEMP"
$destPath = "$destDir\\gs-agent.exe"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  GridSight Student Agent v5.3.0 部署與啟動程序" -ForegroundColor Cyan
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
    netsh advfirewall firewall add rule name="GridSight Agent" dir=in action=allow program="$destPath" enable=yes profile=any protocol=TCP 2>$null | Out-Null
} catch {}

Write-Host "[GridSight] 正在啟動最新版 gs-agent.exe (v5.3.0)..." -ForegroundColor Green
Start-Process -FilePath $destPath -WindowStyle Hidden

Start-Sleep -Seconds 1
$proc = Get-Process -Name "gs-agent" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "[GridSight] ✅ 學生端代理程式 (v5.3.0) 已成功在背景啟動！ (PID: $($proc[0].Id))" -ForegroundColor Green
} else {
    Write-Host "[GridSight] ⚠️ 警告：無法確認背景行程狀態，請檢查防毒軟體或權限設定。" -ForegroundColor Yellow
}
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(script);
});

// Route: Serve gs-agent.exe binary download
const possibleAgentPaths = [
  path.resolve(__dirname, '../../beacon/gs-agent.exe'),
  path.resolve(__dirname, '../downloads/gs-agent.exe'),
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

// Serve frontend dist assets if present
const staticDistPath = process.env.STATIC_DIR || path.resolve(__dirname, '../dist');
if (fs.existsSync(staticDistPath)) {
  app.use(express.static(staticDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/install-agent.ps1' || req.path.startsWith('/download/')) return next();
    res.sendFile(path.join(staticDistPath, 'index.html'));
  });
  logger.info(`[GridSight Server] Serving web console UI from ${staticDistPath}`);
}

server.listen(PORT, HOST, () => {
  logger.info(`[GridSight Server] Coordinator API & WebSocket Relay running on http://${HOST}:${PORT}`);
});
