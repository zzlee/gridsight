import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createServer } from 'http';
import { spawn, ChildProcess } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { TokenAuthority } from './tokenAuthority.js';
import { MulticastDiscoveryService } from './multicastDiscovery.js';
import { TeacherBroadcastStreamer, findFfmpegBinary } from './broadcastStreamer.js';
import { InputEventType } from './inputRtpStreamer.js';
import { logger } from './logger.js';
import { promptSelectNic } from './nicSelector.js';
import { openBrowser } from './browserLauncher.js';
import { buildInstallAgentScript } from './installerScript.js';
import { createZipFromDirectory } from './zipPacker.js';
import { listAudioInputDevices } from './audioDevices.js';
import type { ClassroomLayout, StudentDevice } from './types.js';

interface StudentRecordingSession {
  mac: string;
  label: string;
  filename: string;
  fullPath: string;
  process: ChildProcess;
  startTime: number;
}
const activeStudentRecordings = new Map<string, StudentRecordingSession>();

const currentDirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url || 'file:///'));

// Read version from console/package.json as single source of truth
const APP_VERSION: string = (() => {
  const candidates = [
    path.resolve(currentDirname, '../package.json'),
    path.resolve(currentDirname, '../../console/package.json'),
    path.resolve(process.cwd(), 'console/package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.version) return pkg.version;
    } catch { /* ignore */ }
  }
  return '5.8.10'; // fallback
})();

const app = express();
export const server = createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });

const PORT = process.env.API_PORT || process.env.PORT ? parseInt(process.env.API_PORT || process.env.PORT || '3000', 10) : 3000;
const HOST = process.env.API_HOST || '0.0.0.0';

let activeTeacherIp = '127.0.0.1';
let activeNicName = 'Default';

// CORS allowlist: same-origin requests (no Origin header) are always allowed;
// unknown cross-origin browsers get no CORS headers — defense against
// malicious websites on the LAN abusing unauthenticated endpoints.
const CORS_ALLOWLIST = (process.env.CORS_ORIGINS ||
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || CORS_ALLOWLIST.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(express.json());

export const tokenAuth = new TokenAuthority();
const broadcastStreamer = new TeacherBroadcastStreamer();
const discoveryService = new MulticastDiscoveryService(tokenAuth, (device) => {
  logger.info(`[Discovery] New Beacon: ${device.hostname} (${device.ip})`);
});

// Teacher PIN authentication state
let teacherPin = process.env.TEACHER_PIN || '888888';
export const teacherSessions = new Map<string, number>(); // token -> expiresAt

// Brute-force protection: per-IP failed login tracking with a temporary
// lockout window (in-memory only; resets on server restart). Limits are
// configurable via env so tests can use short windows.
const getLoginMaxAttempts = () => {
  const v = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
};
const getLoginLockoutMs = () => {
  const v = parseInt(process.env.LOGIN_LOCKOUT_MS || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 15 * 60 * 1000;
};
interface LoginFailureEntry { count: number; firstFailureAt: number; lockedUntil: number }
const loginFailures = new Map<string, LoginFailureEntry>(); // ip -> attempts

const pruneLoginFailures = (now = Date.now()) => {
  for (const [ip, entry] of loginFailures) {
    if (now > entry.lockedUntil && now - entry.firstFailureAt > getLoginLockoutMs()) {
      loginFailures.delete(ip);
    }
  }
};

const isLoginLocked = (ip: string): number => {
  const entry = loginFailures.get(ip);
  if (!entry) return 0;
  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
};

const recordLoginFailure = (ip: string) => {
  const now = Date.now();
  const lockoutMs = getLoginLockoutMs();
  const maxAttempts = getLoginMaxAttempts();
  const entry = loginFailures.get(ip);
  if (!entry || now - entry.firstFailureAt > lockoutMs) {
    loginFailures.set(ip, { count: 1, firstFailureAt: now, lockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= maxAttempts) {
    entry.lockedUntil = now + lockoutMs;
  }
};

export const generateTeacherToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days valid
  teacherSessions.set(token, expiresAt);
  return { token, expiresAt };
};

export const isValidTeacherToken = (token: string | null | undefined): boolean => {
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

// Bounded in-memory JPEG cache for authenticated outbound student pushes.
const snapshotCache = new Map<string, { buffer: Buffer; timestamp: number }>();
const SNAPSHOT_CACHE_MAX_KEYS = 256;
const SNAPSHOT_CACHE_TTL_MS = 30_000;

// Maps for WebSocket reverse relay
const agentSockets = new Map<string, WebSocket>();
const viewerSockets = new Map<string, Set<WebSocket>>();
const pendingLogRequests = new Map<string, (logs: string) => void>();
const pendingHighResRequests = new Map<string, (b64Image: string) => void>();

// State for student screen lockout (Feature 1)
const lockedAgents = new Set<string>(); // normalized lowercase MAC addresses
let lastLockMessage = '請看講台專心聽課';

// Normalizes MAC addresses and targets by decoding URL characters and standardizing case
const normalizeCache = new Map<string, string>();
const normalizeTarget = (raw: string) => {
  if (!raw) return '';

  const cached = normalizeCache.get(raw);
  if (cached !== undefined) return cached;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding (e.g. a raw '%' or an invalid '%ZZ'
    // sequence) must never escape into request/connection handlers as an
    // exception — that would crash the server on unauthenticated input.
    // Fall back to the raw input instead.
    decoded = raw;
  }

  const result = decoded.replace(/%3A/gi, ':').trim().toUpperCase();

  // Bound the cache size to prevent memory leaks from unbounded target requests
  if (normalizeCache.size < 10000) {
    normalizeCache.set(raw, result);
  }

  return result;
};

const pruneSnapshotCache = (now = Date.now()) => {
  for (const [key, entry] of snapshotCache) {
    if (now - entry.timestamp > SNAPSHOT_CACHE_TTL_MS) snapshotCache.delete(key);
  }
  if (snapshotCache.size > SNAPSHOT_CACHE_MAX_KEYS) {
    for (const key of snapshotCache.keys()) {
      snapshotCache.delete(key);
      if (snapshotCache.size <= SNAPSHOT_CACHE_MAX_KEYS) break;
    }
  }
};

const storeSnapshot = (key: string, entry: { buffer: Buffer; timestamp: number }) => {
  if (!key) return;
  snapshotCache.delete(key);
  snapshotCache.set(key, entry);
  pruneSnapshotCache(entry.timestamp);
};

/*
 * LRU-aware cache read: re-insert the entry so it moves to the tail of
 * Map iteration order. Without this, pruneSnapshotCache evicts in strict
 * insertion order (FIFO), letting a continuously polled seat flush out
 * cold-but-never-hot entries unfairly.
 */
const getSnapshotCached = (key: string): { buffer: Buffer; timestamp: number } | undefined => {
  const entry = snapshotCache.get(key);
  if (entry === undefined) return undefined;
  snapshotCache.delete(key);
  snapshotCache.set(key, entry);
  return entry;
};

const requireAgentSnapshotAuth: express.RequestHandler = (req, res, next) => {
  const mac = normalizeTarget((req.headers['x-agent-mac'] as string) || '');
  const token = (req.headers['x-auth-token'] as string) || '';
  if (!mac || !tokenAuth.validateToken(mac, token)) {
    return res.status(401).json({ error: 'Unauthorized agent snapshot' });
  }
  next();
};

wss.on('connection', (ws, req) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const parsedUrl = new URL(req.url || '', `http://${host}`);
  const pathname = parsedUrl.pathname;

  if (pathname === '/ws/agent') {
    const rawMac = parsedUrl.searchParams.get('mac') || '';
    const mac = normalizeTarget(rawMac);
    const token = parsedUrl.searchParams.get('token') || '';
    if (!mac || !tokenAuth.validateToken(mac, token)) {
      logger.warn(`[WS Relay] Rejected unauthenticated agent socket from ${req.socket.remoteAddress || 'unknown'}`);
      ws.close(1008, 'Invalid agent credentials');
      return;
    }

    const previous = agentSockets.get(mac);
    if (previous && previous !== ws) {
      previous.close(1008, 'Superseded by a newer authenticated connection');
    }
    agentSockets.set(mac, ws);
    logger.info(`[WS Relay] Authenticated student agent registered outbound: ${mac}`);

    // Auto-relock if this agent was marked as locked
    if (lockedAgents.has(mac.toLowerCase())) {
      try {
        ws.send(JSON.stringify({ action: 'LOCK_SCREEN', message: lastLockMessage }));
        logger.info(`[ScreenLock] Auto-re-locked student ${mac} upon reconnect`);
      } catch {}
    }

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
        // Forward H.264 video NALU frames directly to active student recorder if recording
        const rec = activeStudentRecordings.get(mac);
        if (rec && rec.process.stdin && !rec.process.stdin.destroyed) {
          try {
            rec.process.stdin.write(data);
          } catch {}
        }

        // Forward H.264 video NALU frames directly to broadcast relay if this student is being showcased!
        if (broadcastStreamer.isRelayingStudent(mac)) {
          broadcastStreamer.feedRelayData(data as Buffer);
        }

        // Forward H.264 video NALU frames directly to active teacher viewers
        const viewers = viewerSockets.get(mac);
        if (viewers && viewers.size > 0) {
          viewers.forEach((v) => {
            if (v.readyState !== WebSocket.OPEN) return;
            if (v.bufferedAmount > 8 * 1024 * 1024) {
              logger.warn(`[WS Relay] Closing persistently slow viewer for ${mac}`);
              v.close(1009, 'Viewer backpressure limit exceeded');
              return;
            }
            // Drop frames instead of growing an unbounded queue. The next IDR
            // restores decoder state for a slow viewer.
            if (v.bufferedAmount > 2 * 1024 * 1024) return;
            v.send(data, { binary: true });
          });
        }
      } else {
        try {
          const text = data.toString('utf-8');
          const json = JSON.parse(text);
          if (json.action === 'LOGS_REPORT') {
            const cb = pendingLogRequests.get(mac);
            if (cb) {
              cb(json.logs || '');
              pendingLogRequests.delete(mac);
            }
          } else if (json.action === 'HIGHRES_SNAPSHOT_REPORT') {
            const cb = pendingHighResRequests.get(mac);
            if (cb) {
              cb(json.image || '');
              pendingHighResRequests.delete(mac);
            }
          }
        } catch {}
      }
    });

    ws.on('close', () => {
      if (agentSockets.get(mac) === ws) {
        agentSockets.delete(mac);
      }
      const rec = activeStudentRecordings.get(mac);
      if (rec) {
        try { rec.process.stdin?.end(); } catch {}
        activeStudentRecordings.delete(mac);
        logger.info(`[Student Record] Student ${mac} disconnected, finished recording ${rec.filename}`);
      }
      logger.info(`[WS Relay] Student Agent disconnected: ${mac}`);
    });
  } else if (pathname.startsWith('/ws/stream/')) {
    const teacherToken = parsedUrl.searchParams.get('token');
    if (!isValidTeacherToken(teacherToken)) {
      logger.warn(`[WS Relay] Rejected unauthenticated teacher viewer from ${req.socket.remoteAddress || 'unknown'}`);
      ws.close(1008, 'Teacher authentication required');
      return;
    }

    const rawTarget = pathname.replace('/ws/stream/', '');
    let mac = normalizeTarget(rawTarget);

    // Resolve an explicit IP or hostname to its authenticated agent MAC. Never
    // fall back to an unrelated sole agent because that can disclose its stream.
    if (!agentSockets.has(mac)) {
      const dev = discoveryService.findDevice(rawTarget) || discoveryService.findDevice(mac);
      if (dev) mac = normalizeTarget(dev.mac);
    }
    const agentWs = agentSockets.get(mac);
    if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
      logger.warn(`[WS Relay] No authenticated agent available for target ${mac}`);
      ws.close(1013, 'Agent stream unavailable');
      return;
    }

    if (!viewerSockets.has(mac)) {
      viewerSockets.set(mac, new Set());
    }
    viewerSockets.get(mac)!.add(ws);
    logger.info(`[WS Relay] Teacher Viewer opened stream for: ${mac} (total viewers: ${viewerSockets.get(mac)!.size})`);

    // Tell the authenticated student agent to start H.264 30 FPS encoder.
    agentWs.send(JSON.stringify({ action: 'START_STREAM', fps: 30, bitrate: 2500 }));
    logger.info(`[WS Relay] Sent START_STREAM command to agent: ${mac}`);

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
  } else {
    ws.close(1008, 'Unknown WebSocket endpoint');
  }
});

// Auth Routes: Teacher PIN Login and Verification
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  pruneLoginFailures();
  const remainingLockMs = isLoginLocked(ip);
  if (remainingLockMs > 0) {
    const minutes = Math.ceil(remainingLockMs / 60000);
    logger.warn(`[Auth] Login attempt from ${ip} rejected: temporarily locked out`);
    res.setHeader('Retry-After', String(Math.ceil(remainingLockMs / 1000)));
    return res.status(429).json({ success: false, error: `嘗試次數過多，請 ${minutes} 分鐘後再試` });
  }

  const { pin } = req.body;
  if (typeof pin === 'string' && pin.trim() === teacherPin.trim()) {
    loginFailures.delete(ip);
    const { token, expiresAt } = generateTeacherToken();
    logger.info(`[Auth] Teacher logged in successfully from IP: ${ip}`);
    res.json({ success: true, token, expiresAt });
  } else {
    recordLoginFailure(ip);
    logger.warn(`[Auth] Failed PIN attempt from IP: ${ip}`);
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

const defaultDataDir = (() => {
  if (isStandalone) return path.resolve(process.cwd(), 'data');
  try {
    if (fs.existsSync('/data')) return '/data';
  } catch {}
  return path.resolve(process.cwd(), 'data');
})();

const defaultSeatsFile = path.join(defaultDataDir, 'seats.json');
const SEATS_FILE = process.env.SEATS_FILE || defaultSeatsFile;

const defaultUploadsDir = path.join(defaultDataDir, 'uploads');
const UPLOADS_DIR = process.env.UPLOADS_DIR || defaultUploadsDir;

// Directory for media files uploaded for a broadcast test (streamed via RTP multicast).
const BROADCAST_TEST_DIR = path.join(UPLOADS_DIR, 'broadcast-test');

const ensureBroadcastTestDirectory = async () => {
  try {
    await fs.promises.mkdir(BROADCAST_TEST_DIR, { recursive: true });
  } catch (err) {
    logger.warn(`[Broadcast Test] Failed to create directory ${BROADCAST_TEST_DIR}: ${err}`);
  }
};

const ensureSeatsDirectory = async () => {
  const dir = path.dirname(SEATS_FILE);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    logger.warn(`[Seats] Failed to create directory ${dir}: ${err}`);
  }
};

const ensureUploadsDirectory = async () => {
  try {
    await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
  } catch (err) {
    logger.warn(`[Share] Failed to create uploads directory ${UPLOADS_DIR}: ${err}`);
  }
};

const defaultRecordingsDir = path.join(defaultDataDir, 'recordings');
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || defaultRecordingsDir;

const ensureRecordingsDirectory = async () => {
  try {
    await fs.promises.mkdir(RECORDINGS_DIR, { recursive: true });
  } catch (err) {
    logger.warn(`[Recordings] Failed to create recordings directory ${RECORDINGS_DIR}: ${err}`);
  }
};

const defaultAssignmentsDir = path.join(defaultDataDir, 'assignments');
const ASSIGNMENTS_DIR = process.env.ASSIGNMENTS_DIR || defaultAssignmentsDir;

const ensureAssignmentsDirectory = async () => {
  try {
    await fs.promises.mkdir(ASSIGNMENTS_DIR, { recursive: true });
  } catch (err) {
    logger.warn(`[Assignments] Failed to create assignments directory ${ASSIGNMENTS_DIR}: ${err}`);
  }
};

const DEFAULT_OFFTASK_KEYWORDS = [
  'YouTube', 'Bilibili', 'Roblox', 'Minecraft', 'Steam',
  'Discord', 'Twitch', '抖音', 'Tiktok', '巴哈姆特',
  '動畫瘋', 'Facebook', 'Instagram', 'Netflix', 'Game', '遊戲'
];

const getDefaultSeatsLayout = (): ClassroomLayout => {
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

let cachedLayout: ClassroomLayout | null = null;

const sanitizeLayoutForPersistence = (layoutData: ClassroomLayout): ClassroomLayout => ({
  ...layoutData,
  seats: layoutData.seats.map((seat) => {
    const sanitized = { ...seat };
    delete sanitized.token;
    delete sanitized.thumbnailUrl;
    return sanitized;
  }),
});

const saveSeatsLayout = async (layoutData: ClassroomLayout): Promise<boolean> => {
  await ensureSeatsDirectory();
  const sanitizedLayout = sanitizeLayoutForPersistence(layoutData);

  /*
   * Atomic write: write to a temp file in the same directory and rename
   * it over the target. A crash/power loss mid-write can never leave a
   * truncated or half-written seats.json behind; rename is atomic on
   * POSIX and best-effort atomic (REPLACE_EXISTING) on Windows.
   */
  const tempFile = `${SEATS_FILE}.tmp-${process.pid}`;
  try {
    await ensureSeatsDirectory();
    await fs.promises.writeFile(tempFile, JSON.stringify(sanitizedLayout, null, 2), 'utf-8');
    await fs.promises.rename(tempFile, SEATS_FILE);
    logger.info(`[Seats] Successfully saved layout to ${SEATS_FILE}`);
    cachedLayout = sanitizedLayout;
    return true;
  } catch (err) {
    logger.error(`[Seats] Failed to write layout to ${SEATS_FILE}: ${err}`);
    try { await fs.promises.unlink(tempFile); } catch { /* temp file already gone */ }
    return false;
  }
};

const loadSeatsLayout = async (): Promise<ClassroomLayout> => {
  if (cachedLayout) {
    return cachedLayout;
  }
  await ensureSeatsDirectory();
  try {
    const content = await fs.promises.readFile(SEATS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.seats)) {
      // Filter out legacy dummy offline seats
      const cleanedSeats = parsed.seats.filter(
        (s: Partial<StudentDevice>) =>
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
      cachedLayout = sanitizeLayoutForPersistence(parsed as ClassroomLayout);
      return cachedLayout;
    }
  } catch (err) {
    logger.warn(`[Seats] Error reading ${SEATS_FILE}: ${err}`);
  }

  const defaultLayout = getDefaultSeatsLayout();
  await saveSeatsLayout(defaultLayout);
  return defaultLayout;
};

app.get('/api/health', (req, res) => {
  const discovery = discoveryService.getHealth();
  res.json({
    status: discovery.listening ? 'ok' : 'degraded',
    time: Date.now(),
    components: {
      http: { listening: server.listening },
      discovery,
      websocket: {
        authenticatedAgents: agentSockets.size,
        activeViewerTargets: viewerSockets.size,
      },
      snapshots: {
        cacheKeys: snapshotCache.size,
        maxKeys: SNAPSHOT_CACHE_MAX_KEYS,
        ttlMs: SNAPSHOT_CACHE_TTL_MS,
      },
      broadcast: { active: broadcastStreamer.isActive() },
    },
  });
});

app.get('/api/server-info', (req, res) => {
  res.json({
    version: APP_VERSION,
    teacherIp: activeTeacherIp,
    port: PORT,
    nicName: activeNicName,
  });
});

app.get('/api/layout', requireTeacherAuth, async (req, res) => {
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

interface AssignmentSubmission {
  mac: string;
  ip: string;
  hostname: string;
  seatNo: string;
  filename: string;
  size: number;
  submittedAt: number;
  filePath: string;
}

interface AssignmentSession {
  id: string;
  title: string;
  allowedExts: string[];
  maxSizeMb: number;
  createdAt: number;
  active: boolean;
  submissions: Map<string, AssignmentSubmission>;
}

const assignmentSessions = new Map<string, AssignmentSession>();
let activeAssignmentId: string | null = null;

app.get('/api/agents', requireTeacherAuth, (req, res) => {
  const rawDevices = discoveryService.getDevices();
  const activeSession = activeAssignmentId ? assignmentSessions.get(activeAssignmentId) : null;
  const agents = rawDevices.map((d) => {
    const sub = (activeSession && d.mac) ? activeSession.submissions.get(d.mac.toLowerCase()) : undefined;
    return {
      ...d,
      isLocked: d.mac ? lockedAgents.has(d.mac.toLowerCase()) : false,
      hasSubmitted: !!sub,
      submissionInfo: sub ? { filename: sub.filename, size: sub.size, submittedAt: sub.submittedAt } : undefined,
    };
  });
  res.json({
    agents,
    count: agents.length,
  });
});

app.get('/api/devices', requireTeacherAuth, (req, res) => {
  const rawDevices = discoveryService.getDevices();
  const activeSession = activeAssignmentId ? assignmentSessions.get(activeAssignmentId) : null;
  const devices = rawDevices.map((d) => {
    const sub = (activeSession && d.mac) ? activeSession.submissions.get(d.mac.toLowerCase()) : undefined;
    return {
      ...d,
      isLocked: d.mac ? lockedAgents.has(d.mac.toLowerCase()) : false,
      hasSubmitted: !!sub,
      submissionInfo: sub ? { filename: sub.filename, size: sub.size, submittedAt: sub.submittedAt } : undefined,
    };
  });
  res.json({
    devices,
    count: devices.length,
  });
});

const notifyStopBroadcast = (excludeMac?: string) => {
  logger.info(`[Broadcast] Broadcasting STOP_BROADCAST to agents (total sockets: ${agentSockets.size})`);
  const normExclude = excludeMac?.toLowerCase();
  agentSockets.forEach((ws, mac) => {
    if (normExclude && mac.toLowerCase() === normExclude) return;
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ action: 'STOP_BROADCAST' }));
      } catch (err) {
        logger.error(`[Broadcast] Failed to send STOP_BROADCAST to agent ${mac}: ${err}`);
      }
    }
  });
};

app.post('/api/broadcast/start', requireTeacherAuth, async (req, res) => {
  await ensureRecordingsDirectory();
  const shouldRecord = req.body?.record === true || req.body?.record === 'true';
  let recordFile: string | undefined;
  if (shouldRecord) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    recordFile = path.join(RECORDINGS_DIR, `GridSight_Broadcast_${timestamp}.mp4`);
  }
  const result = await broadcastStreamer.startStream({
    ...(req.body || {}),
    localIp: activeTeacherIp,
    record: shouldRecord,
    recordFile,
  });
  if (!result.ok) {
    return res.status(500).json({ status: 'error', active: false, error: result.error || '廣播啟動失敗' });
  }
  res.json({
    status: 'streaming',
    active: true,
    recording: broadcastStreamer.getRecordingStatus().isRecording,
  });
});

app.post('/api/broadcast/stop', requireTeacherAuth, (req, res) => {
  const relayMac = broadcastStreamer.getRelayStudent();
  if (relayMac) {
    const norm = relayMac.toLowerCase();
    const showcaseWs = agentSockets.get(norm) || Array.from(agentSockets.entries()).find(([k]) => k.toLowerCase() === norm)?.[1];
    if (showcaseWs && showcaseWs.readyState === WebSocket.OPEN) {
      try {
        showcaseWs.send(JSON.stringify({ action: 'SHOWCASE_STOP' }));
        if (!viewerSockets.get(norm)?.size) {
          showcaseWs.send(JSON.stringify({ action: 'STOP_STREAM' }));
        }
      } catch {}
    }
  }
  broadcastStreamer.stopStream();
  notifyStopBroadcast();
  res.json({ status: 'stopped', active: false });
});

// === Student Showcase Broadcast Routes (Feature 3) ===
app.post('/api/broadcast/showcase/start', requireTeacherAuth, async (req, res) => {
  const targetMac = req.body?.mac;
  if (!targetMac || typeof targetMac !== 'string') {
    return res.status(400).json({ error: '請提供欲轉播的學生 MAC 地址' });
  }
  const normMac = targetMac.toLowerCase();
  const targetDevice = discoveryService.findDevice(normMac);
  if (!targetDevice) {
    return res.status(404).json({ error: '找不到該學生設備' });
  }

  // Stop existing broadcast or stream if running
  if (broadcastStreamer.isActive()) {
    const prevRelay = broadcastStreamer.getRelayStudent();
    if (prevRelay) {
      const prevWs = agentSockets.get(prevRelay.toLowerCase()) || Array.from(agentSockets.entries()).find(([k]) => k.toLowerCase() === prevRelay.toLowerCase())?.[1];
      try { prevWs?.send(JSON.stringify({ action: 'SHOWCASE_STOP' })); } catch {}
    }
    broadcastStreamer.stopStream();
  }

  await ensureRecordingsDirectory();
  const shouldRecord = req.body?.record === true || req.body?.record === 'true';
  let recordFile: string | undefined;
  if (shouldRecord) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const safeName = (targetDevice.hostname || targetDevice.ip || 'Student').replace(/[^a-zA-Z0-9_-]/g, '_');
    recordFile = path.join(RECORDINGS_DIR, `GridSight_Showcase_${safeName}_${timestamp}.mp4`);
  }

  // 1. Instruct showcase student to start 30 FPS stream and show showcase toast
  const showcaseWs = agentSockets.get(normMac) || Array.from(agentSockets.entries()).find(([k]) => k.toLowerCase() === normMac)?.[1];
  if (showcaseWs && showcaseWs.readyState === WebSocket.OPEN) {
    try {
      showcaseWs.send(JSON.stringify({ action: 'SHOWCASE_START' }));
      showcaseWs.send(JSON.stringify({ action: 'START_STREAM', fps: 30, bitrate: 2500, showcase: true }));
    } catch (err) {
      return res.status(500).json({ error: `無法向學生機發送轉播信令: ${err}` });
    }
  } else {
    return res.status(400).json({ error: '該學生 Agent 尚未連線，無法發起轉播' });
  }

  // 2. Start broadcast streamer in student-relay mode
  const result = await broadcastStreamer.startStream({
    sourceType: 'student-relay',
    relayMac: normMac,
    fps: 30,
    bitrateKbps: 3000,
    localIp: activeTeacherIp,
    record: shouldRecord,
    ...(recordFile ? { recordFile } : {}),
  });

  if (!result.ok) {
    try { showcaseWs.send(JSON.stringify({ action: 'SHOWCASE_STOP' })); } catch {}
    return res.status(500).json({ error: result.error || '啟動學生畫面轉播失敗' });
  }

  logger.info(`[Broadcast] Showcase broadcast live for student ${targetDevice.hostname} (${normMac})`);
  res.json({
    ok: true,
    status: 'showcase_streaming',
    studentMac: normMac,
    studentName: targetDevice.hostname || targetDevice.ip,
    recording: broadcastStreamer.getRecordingStatus().isRecording,
  });
});

app.post('/api/broadcast/showcase/stop', requireTeacherAuth, (req, res) => {
  const relayMac = broadcastStreamer.getRelayStudent();
  if (relayMac) {
    const norm = relayMac.toLowerCase();
    const showcaseWs = agentSockets.get(norm) || Array.from(agentSockets.entries()).find(([k]) => k.toLowerCase() === norm)?.[1];
    if (showcaseWs && showcaseWs.readyState === WebSocket.OPEN) {
      try {
        showcaseWs.send(JSON.stringify({ action: 'SHOWCASE_STOP' }));
        if (!viewerSockets.get(norm)?.size) {
          showcaseWs.send(JSON.stringify({ action: 'STOP_STREAM' }));
        }
      } catch {}
    }
  }
  broadcastStreamer.stopStream();
  notifyStopBroadcast();
  res.json({ ok: true, status: 'stopped' });
});

app.get('/api/broadcast/showcase/status', requireTeacherAuth, (req, res) => {
  const relayMac = broadcastStreamer.getRelayStudent();
  const isRelay = Boolean(relayMac && broadcastStreamer.isActive());
  let studentName: string | null = null;
  if (relayMac) {
    const dev = discoveryService.findDevice(relayMac.toLowerCase());
    studentName = dev?.hostname || dev?.ip || relayMac;
  }
  res.json({
    active: isRelay,
    studentMac: isRelay ? relayMac : null,
    studentName: isRelay ? studentName : null,
  });
});

// === Student Screen Lockout Routes (Feature 1) ===
app.post('/api/screen/lock', requireTeacherAuth, (req, res) => {
  const targets = req.body?.targets;
  const message = typeof req.body?.message === 'string' && req.body.message.trim() ? req.body.message.trim() : '請看講台專心聽課';
  lastLockMessage = message;
  let lockedCount = 0;

  if (!targets || targets === 'all') {
    agentSockets.forEach((ws, mac) => {
      lockedAgents.add(mac.toLowerCase());
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: 'LOCK_SCREEN', message }));
          lockedCount++;
        } catch {}
      }
    });
    discoveryService.getDevices().forEach((dev) => {
      if (dev.mac) lockedAgents.add(dev.mac.toLowerCase());
    });
  } else if (Array.isArray(targets)) {
    for (const t of targets) {
      const norm = String(t).toLowerCase();
      lockedAgents.add(norm);
      const ws = agentSockets.get(norm) || Array.from(agentSockets.entries()).find(([k]) => k.toLowerCase() === norm)?.[1];
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: 'LOCK_SCREEN', message }));
          lockedCount++;
        } catch {}
      }
    }
  }

  logger.info(`[ScreenLock] Locked ${lockedCount} active agents (tracked locked: ${lockedAgents.size})`);
  res.json({ ok: true, lockedCount, totalLocked: lockedAgents.size });
});

app.post('/api/screen/unlock', requireTeacherAuth, (req, res) => {
  const targets = req.body?.targets;
  let unlockedCount = 0;

  if (!targets || targets === 'all') {
    agentSockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: 'UNLOCK_SCREEN' }));
          unlockedCount++;
        } catch {}
      }
    });
    lockedAgents.clear();
  } else if (Array.isArray(targets)) {
    for (const t of targets) {
      const norm = String(t).toLowerCase();
      lockedAgents.delete(norm);
      const ws = agentSockets.get(norm) || Array.from(agentSockets.entries()).find(([k]) => k.toLowerCase() === norm)?.[1];
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: 'UNLOCK_SCREEN' }));
          unlockedCount++;
        } catch {}
      }
    }
  }

  logger.info(`[ScreenLock] Unlocked ${unlockedCount} agents (remaining locked: ${lockedAgents.size})`);
  res.json({ ok: true, unlockedCount, remainingLocked: lockedAgents.size });
});

app.get('/api/screen/status', requireTeacherAuth, (req, res) => {
  res.json({
    lockedCount: lockedAgents.size,
    lockedMacs: Array.from(lockedAgents),
    defaultMessage: lastLockMessage,
  });
});

// === Assignment Dropbox Collection Routes (Feature 2) ===
app.post('/api/assignments/start', requireTeacherAuth, async (req, res) => {
  await ensureAssignmentsDirectory();
  const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : '課堂作業';
  const allowedExts = Array.isArray(req.body?.allowedExts)
    ? req.body.allowedExts.map((e: string) => String(e).trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
    : [];
  const maxSizeMb = typeof req.body?.maxSizeMb === 'number' && req.body.maxSizeMb > 0 ? req.body.maxSizeMb : 50;
  const targets = req.body?.targets;

  const id = `as-${Date.now().toString(36)}-${crypto.randomBytes(16).toString('hex')}`;
  const sessionDir = path.join(ASSIGNMENTS_DIR, id);
  await fs.promises.mkdir(sessionDir, { recursive: true });

  const session: AssignmentSession = {
    id,
    title,
    allowedExts,
    maxSizeMb,
    createdAt: Date.now(),
    active: true,
    submissions: new Map(),
  };
  assignmentSessions.set(id, session);
  activeAssignmentId = id;

  const hostIp = activeTeacherIp && activeTeacherIp !== '127.0.0.1' ? activeTeacherIp : '127.0.0.1';
  const uploadUrl = `http://${hostIp}:${PORT}/api/assignments/upload`;

  const payload = JSON.stringify({
    action: 'COLLECT_ASSIGNMENT',
    id,
    title,
    allowedExts: allowedExts.join(','),
    maxSizeMb,
    uploadUrl,
  });

  let count = 0;
  if (!targets || targets === 'all' || (Array.isArray(targets) && (targets.length === 0 || targets.includes('ALL')))) {
    agentSockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(payload); count++; } catch {}
      }
    });
  } else if (Array.isArray(targets)) {
    for (const t of targets) {
      const norm = normalizeTarget(String(t));
      const ws = agentSockets.get(norm) || Array.from(agentSockets.entries()).find(([k]) => k.toLowerCase() === norm)?.[1];
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(payload); count++; } catch {}
      }
    }
  }

  logger.info(`[Assignments] Started assignment collection "${title}" (id: ${id}), broadcast to ${count} agents`);
  res.json({
    ok: true,
    session: {
      id,
      title,
      allowedExts,
      maxSizeMb,
      createdAt: session.createdAt,
      active: true,
      submissionsCount: 0,
    },
    targetCount: count,
  });
});

app.post('/api/assignments/stop', requireTeacherAuth, (req, res) => {
  if (activeAssignmentId) {
    const session = assignmentSessions.get(activeAssignmentId);
    if (session) session.active = false;
    activeAssignmentId = null;
  }
  const payload = JSON.stringify({ action: 'STOP_ASSIGNMENT' });
  let count = 0;
  agentSockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(payload); count++; } catch {}
    }
  });
  logger.info(`[Assignments] Stopped active assignment collection, notified ${count} agents`);
  res.json({ ok: true, count });
});

app.post('/api/assignments/remind', requireTeacherAuth, (req, res) => {
  if (!activeAssignmentId) {
    return res.status(400).json({ error: '目前沒有進行中的作業收取' });
  }
  const session = assignmentSessions.get(activeAssignmentId);
  if (!session || !session.active) {
    return res.status(400).json({ error: '目前沒有進行中的作業收取' });
  }

  const hostIp = activeTeacherIp && activeTeacherIp !== '127.0.0.1' ? activeTeacherIp : '127.0.0.1';
  const uploadUrl = `http://${hostIp}:${PORT}/api/assignments/upload`;

  const payload = JSON.stringify({
    action: 'COLLECT_ASSIGNMENT',
    id: session.id,
    title: session.title,
    allowedExts: session.allowedExts.join(','),
    maxSizeMb: session.maxSizeMb,
    uploadUrl,
  });

  let remindedCount = 0;
  agentSockets.forEach((ws, mac) => {
    if (!session.submissions.has(mac.toLowerCase())) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(payload); remindedCount++; } catch {}
      }
    }
  });

  logger.info(`[Assignments] Reminded ${remindedCount} unsubmitted agents for assignment "${session.title}"`);
  res.json({ ok: true, remindedCount });
});

app.get('/api/assignments/active', requireTeacherAuth, (req, res) => {
  if (!activeAssignmentId) {
    return res.json({ active: false });
  }
  const session = assignmentSessions.get(activeAssignmentId);
  if (!session || !session.active) {
    return res.json({ active: false });
  }
  res.json({
    active: true,
    session: {
      id: session.id,
      title: session.title,
      allowedExts: session.allowedExts,
      maxSizeMb: session.maxSizeMb,
      createdAt: session.createdAt,
      active: session.active,
      submissions: Array.from(session.submissions.values()),
    },
  });
});

app.get('/api/assignments/list', requireTeacherAuth, (req, res) => {
  const list = Array.from(assignmentSessions.values()).map((s) => ({
    id: s.id,
    title: s.title,
    allowedExts: s.allowedExts,
    maxSizeMb: s.maxSizeMb,
    createdAt: s.createdAt,
    active: s.active,
    submissionsCount: s.submissions.size,
  }));
  res.json({ list });
});

app.post(
  '/api/assignments/upload',
  express.raw({ type: ['application/octet-stream', '*/*'], limit: '100mb' }),
  async (req, res) => {
    await ensureAssignmentsDirectory();
    const rawMac = (req.headers['x-agent-mac'] as string) || '';
    const ip = (req.headers['x-agent-ip'] as string) || req.ip?.replace(/^.*:/, '') || '';
    const rawAssignmentId = (req.headers['x-assignment-id'] as string) || (req.query.id as string) || activeAssignmentId || '';
    const rawFilenameB64 = (req.headers['x-filename'] as string) || '';
    const mac = normalizeTarget(rawMac);

    let filename = 'submission.bin';
    if (rawFilenameB64) {
      try {
        filename = Buffer.from(rawFilenameB64, 'base64').toString('utf8');
      } catch {
        filename = rawFilenameB64;
      }
    }

    const session = assignmentSessions.get(rawAssignmentId) || (activeAssignmentId ? assignmentSessions.get(activeAssignmentId) : null);
    if (!session) {
      return res.status(404).json({ error: '找不到指定的作業收取作業' });
    }

    // Verify allowed extension
    if (session.allowedExts.length > 0) {
      const dotIdx = filename.lastIndexOf('.');
      const ext = dotIdx >= 0 ? filename.substring(dotIdx + 1).toLowerCase() : '';
      if (!session.allowedExts.includes(ext) && !session.allowedExts.includes('*')) {
        return res.status(400).json({ error: `檔案副檔名不符 (僅限: ${session.allowedExts.join(', ')})` });
      }
    }

    const buffer = req.body as Buffer;
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: '上傳檔案為空' });
    }

    // Look up student seat number and hostname
    const dev = discoveryService.findDevice(mac) || discoveryService.findDevice(ip);
    const hostname = dev?.hostname || 'Unknown';
    let seatNo = '未排座';
    if (cachedLayout && dev) {
      const s = cachedLayout.seats.find((seat) => (dev.mac && seat.mac === dev.mac) || (dev.ip && seat.ip === dev.ip));
      if (s) seatNo = s.seatNo || `${s.gridY + 1}-${s.gridX + 1}`;
    }

    const safeFilename = path.basename(filename).replace(/[/\\?%*:|"<>]/g, '_');
    const safeHostname = hostname.replace(/[/\\?%*:|"<>]/g, '_');
    const safeSeatNo = seatNo.replace(/[/\\?%*:|"<>]/g, '_');

    // Standardized filename: [SeatNo]_[Hostname]_[Filename]
    // Option 2-A: Overwrite existing file on re-upload
    const targetFilename = `${safeSeatNo}_${safeHostname}_${safeFilename}`;
    const assignmentDir = path.join(ASSIGNMENTS_DIR, session.id);
    await fs.promises.mkdir(assignmentDir, { recursive: true });
    const targetPath = path.join(assignmentDir, targetFilename);

    await fs.promises.writeFile(targetPath, buffer);

    const submission: AssignmentSubmission = {
      mac,
      ip,
      hostname,
      seatNo,
      filename,
      size: buffer.length,
      submittedAt: Date.now(),
      filePath: targetPath,
    };
    session.submissions.set(mac.toLowerCase(), submission);

    logger.info(`[Assignments] Received submission from ${hostname} (${seatNo}): ${targetFilename} (${(buffer.length / 1024).toFixed(1)} KB)`);
    res.json({
      ok: true,
      filename: targetFilename,
      size: buffer.length,
      submittedAt: submission.submittedAt,
    });
  }
);

app.get('/api/assignments/:id/download-zip', requireTeacherAuth, async (req, res) => {
  const rawId = req.params.id;
  if (!rawId) {
    return res.status(400).json({ error: '缺少作業識別碼' });
  }
  const id: string = rawId;
  const session = assignmentSessions.get(id);
  const sessionDir = path.join(ASSIGNMENTS_DIR, id);

  if (!fs.existsSync(sessionDir)) {
    return res.status(404).json({ error: '找不到該作業資料夾' });
  }

  const title: string = session?.title || id || '課堂作業';
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '_');
  const zipBuf = createZipFromDirectory(sessionDir);

  res.setHeader('Content-Type', 'application/zip');
  const encodedName = encodeURIComponent(`GridSight_作業_${safeTitle}.zip`);
  res.setHeader('Content-Disposition', `attachment; filename="GridSight_Assignment.zip"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Content-Length', zipBuf.length);
  res.send(zipBuf);
});

app.get('/api/broadcast/status', requireTeacherAuth, (req, res) => {
  res.json({
    active: broadcastStreamer.isActive(),
    mode: broadcastStreamer.getMode(),
    quality: broadcastStreamer.getQuality(),
    bitrateKbps: broadcastStreamer.getBitrateKbps(),
    recording: broadcastStreamer.getRecordingStatus(),
  });
});

// === Screen Recording API Routes (Native In-Pipeline DXGI & Mouse Overlay) ===
app.get('/api/record/status', requireTeacherAuth, (req, res) => {
  const status = broadcastStreamer.getRecordingStatus();
  res.json({
    ...status,
    isBroadcasting: broadcastStreamer.isActive() && !status.isRecordOnly,
  });
});

app.get('/api/record/audio-devices', requireTeacherAuth, async (_req, res) => {
  try {
    const devices = await listAudioInputDevices();
    res.json({ ok: true, devices });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('[Record] Failed to list audio devices:', msg);
    res.status(500).json({ error: `無法取得音訊裝置: ${msg}` });
  }
});

app.post('/api/record/start', requireTeacherAuth, async (req, res) => {
  await ensureRecordingsDirectory();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `GridSight_Record_${timestamp}.mp4`;
  const recordFile = path.join(RECORDINGS_DIR, filename);
  const audioDevice = typeof req.body?.audioDevice === 'string' ? req.body.audioDevice : 'default';

  if (broadcastStreamer.isActive()) {
    const status = broadcastStreamer.getRecordingStatus();
    if (status.isRecording) {
      return res.json({ status: 'recording', alreadyRecording: true, ...status });
    }
    const ok = await broadcastStreamer.toggleRecordingOnActiveStream(true, RECORDINGS_DIR, audioDevice);
    if (!ok) {
      return res.status(500).json({ error: '無法為當前廣播啟用同步錄製' });
    }
    return res.json({ status: 'recording', ...broadcastStreamer.getRecordingStatus() });
  }

  // Not broadcasting -> recordOnly mode
  const result = await broadcastStreamer.startStream({
    sourceType: 'screen',
    quality: req.body?.quality || 'high',
    recordOnly: true,
    recordFile,
    audioDevice,
    localIp: activeTeacherIp,
  });
  if (!result.ok) {
    return res.status(500).json({ error: result.error || '啟動螢幕錄製失敗' });
  }
  res.json({ status: 'recording', ...broadcastStreamer.getRecordingStatus() });
});

app.post('/api/record/stop', requireTeacherAuth, async (req, res) => {
  const status = broadcastStreamer.getRecordingStatus();
  if (!status.isRecording) {
    return res.json({ status: 'idle', message: '目前無正在進行的錄製' });
  }

  if (status.isRecordOnly) {
    broadcastStreamer.stopStream();
  } else {
    await broadcastStreamer.toggleRecordingOnActiveStream(false);
  }

  const finalInfo = broadcastStreamer.getRecordingStatus().lastSavedRecording;
  res.json({ status: 'stopped', fileInfo: finalInfo });
});

app.get('/api/record/list', requireTeacherAuth, async (req, res) => {
  await ensureRecordingsDirectory();
  try {
    const files = await fs.promises.readdir(RECORDINGS_DIR);
    const mp4Files = files.filter((f) => f.toLowerCase().endsWith('.mp4'));
    const list = await Promise.all(
      mp4Files.map(async (filename) => {
        const fullPath = path.join(RECORDINGS_DIR, filename);
        const stat = await fs.promises.stat(fullPath);
        const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
        return {
          filename,
          sizeBytes: stat.size,
          sizeFormatted: `${sizeMB} MB`,
          createdAt: stat.birthtimeMs || stat.mtimeMs,
          downloadUrl: `/api/record/download/${encodeURIComponent(filename)}`,
        };
      })
    );
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: '無法讀取錄影清單' });
  }
});

app.get('/api/record/download/:filename', requireTeacherAuth, (req, res) => {
  const rawFilename = req.params.filename ?? '';
  const safeFilename = path.basename(rawFilename);
  const filePath = path.join(RECORDINGS_DIR, safeFilename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(RECORDINGS_DIR) + path.sep)) {
    return res.status(403).json({ error: '拒絕存取' });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: '檔案不存在' });
  }
  res.download(resolved, safeFilename);
});

app.delete('/api/record/:filename', requireTeacherAuth, async (req, res) => {
  const rawFilename = req.params.filename ?? '';
  const safeFilename = path.basename(rawFilename);
  const filePath = path.join(RECORDINGS_DIR, safeFilename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(RECORDINGS_DIR) + path.sep)) {
    return res.status(403).json({ error: '拒絕存取' });
  }
  try {
    await fs.promises.unlink(resolved);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '刪除檔案失敗' });
  }
});

// === Student Focus Stream Native H.264 Recording API ===
app.get('/api/record/student/status', requireTeacherAuth, (req, res) => {
  const rawTarget = (req.query.mac as string) || (req.query.target as string) || '';
  let mac = normalizeTarget(rawTarget);
  if (!activeStudentRecordings.has(mac)) {
    const dev = discoveryService.findDevice(rawTarget) || discoveryService.findDevice(mac);
    if (dev) mac = normalizeTarget(dev.mac);
  }

  const rec = activeStudentRecordings.get(mac);
  if (!rec) {
    return res.json({ isRecording: false });
  }
  let fileSizeBytes = 0;
  try {
    fileSizeBytes = fs.statSync(rec.fullPath).size;
  } catch {}
  res.json({
    isRecording: true,
    mac: rec.mac,
    label: rec.label,
    filename: rec.filename,
    startTime: rec.startTime,
    durationSeconds: Math.floor((Date.now() - rec.startTime) / 1000),
    fileSizeBytes,
  });
});

app.post('/api/record/student/start', requireTeacherAuth, async (req, res) => {
  await ensureRecordingsDirectory();
  const rawTarget = (req.body?.mac as string) || (req.body?.target as string) || '';
  let mac = normalizeTarget(rawTarget);
  const dev = discoveryService.findDevice(rawTarget) || discoveryService.findDevice(mac);
  if (dev) mac = normalizeTarget(dev.mac);

  const label = (req.body?.label as string) || (dev?.seatNo ? `Seat${dev.seatNo}` : (dev?.hostname || mac.replace(/[:]/g, '').slice(-4)));

  if (activeStudentRecordings.has(mac)) {
    const existing = activeStudentRecordings.get(mac)!;
    return res.json({
      ok: true,
      alreadyRecording: true,
      filename: existing.filename,
      startTime: existing.startTime,
    });
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const safeLabel = label.replace(/[^\w\u4e00-\u9fa5-]/g, '_');
  const filename = `GridSight_Student_${safeLabel}_${timestamp}.mp4`;
  const fullPath = path.join(RECORDINGS_DIR, filename);

  const ffmpegCmd = findFfmpegBinary();
  const ffmpegArgs = [
    '-r', '30',
    '-f', 'h264',
    '-i', '-',
    '-c:v', 'copy',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-y',
    fullPath
  ];

  try {
    const child = spawn(ffmpegCmd, ffmpegArgs, {
      stdio: ['pipe', 'ignore', 'ignore']
    });

    child.on('error', (err) => {
      logger.warn(`[Student Record] FFmpeg error for ${mac}: ${err.message}`);
      activeStudentRecordings.delete(mac);
    });

    child.on('exit', (code) => {
      logger.info(`[Student Record] FFmpeg finished for ${mac} (code ${code})`);
      activeStudentRecordings.delete(mac);
    });

    const session: StudentRecordingSession = {
      mac,
      label,
      filename,
      fullPath,
      process: child,
      startTime: Date.now(),
    };

    activeStudentRecordings.set(mac, session);
    logger.info(`[Student Record] Started native H.264 recording for student ${mac} (${label}) -> ${filename}`);

    res.json({
      ok: true,
      isRecording: true,
      filename,
      startTime: session.startTime,
    });
  } catch (err: any) {
    logger.error(`[Student Record] Failed to launch FFmpeg: ${err.message}`);
    res.status(500).json({ error: '無法啟動學生畫面錄製行程' });
  }
});

app.post('/api/record/student/stop', requireTeacherAuth, async (req, res) => {
  const rawTarget = (req.body?.mac as string) || (req.body?.target as string) || '';
  let mac = normalizeTarget(rawTarget);
  if (!activeStudentRecordings.has(mac)) {
    const dev = discoveryService.findDevice(rawTarget) || discoveryService.findDevice(mac);
    if (dev) mac = normalizeTarget(dev.mac);
  }

  const rec = activeStudentRecordings.get(mac);
  if (!rec) {
    return res.json({ ok: true, isRecording: false, message: '目前無正在進行的學生錄製' });
  }

  activeStudentRecordings.delete(mac);

  try {
    rec.process.stdin?.end();
  } catch {}

  // Wait brief moment for FFmpeg to finalize
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try { rec.process.kill('SIGTERM'); } catch {}
      resolve();
    }, 1000);
    rec.process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(rec.fullPath).size;
  } catch {}

  const durationSeconds = Math.floor((Date.now() - rec.startTime) / 1000);
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);

  logger.info(`[Student Record] Stopped recording for ${mac}: ${rec.filename} (${sizeMB} MB, ${durationSeconds}s)`);

  res.json({
    ok: true,
    filename: rec.filename,
    durationSeconds,
    sizeBytes,
    sizeFormatted: `${sizeMB} MB`,
    downloadUrl: `/api/record/download/${encodeURIComponent(rec.filename)}`,
  });
});

app.post('/api/broadcast/input-event', requireTeacherAuth, (req, res) => {
  const { eventType, normX, normY, buttonFlags, scrollDelta, modifierFlags, keyCode } = req.body || {};
  const streamer = broadcastStreamer.getInputRtpStreamer();
  const ok = streamer.sendEvent({
    eventType: eventType ?? InputEventType.MouseMove,
    normX,
    normY,
    buttonFlags,
    scrollDelta,
    modifierFlags,
    keyCode,
    timestampMs: Date.now(),
  });
  res.json({ ok, active: streamer.isActive() });
});

// Route: Broadcast Test - upload a media file for RTP multicast test streaming
app.post(
  '/api/broadcast/test-media',
  requireTeacherAuth,
  express.raw({ type: ['*/*'], limit: '400mb' }),
  async (req, res) => {
    try {
      await ensureBroadcastTestDirectory();
      const rawFilename = (req.headers['x-filename'] as string) || 'test_media.mp4';
      let filename = 'test_media.mp4';
      try {
        filename = decodeURIComponent(rawFilename);
      } catch {
        filename = rawFilename;
      }
      const safeName = path.basename(filename).replace(/[/\\?%*:|"<>]/g, '_');
      const ext = path.extname(safeName).toLowerCase() || '.mp4';
      const fileId = Date.now().toString(36) + crypto.randomBytes(16).toString('hex');
      const storedName = `media_${fileId}${ext}`;
      const savedPath = path.join(BROADCAST_TEST_DIR, storedName);

      const totalBytes = Buffer.isBuffer(req.body) ? req.body.length : 0;
      if (!totalBytes) {
        return res.status(400).json({ error: '測試媒體檔案內容不可為空' });
      }
      await fs.promises.writeFile(savedPath, req.body);
      logger.info(`[Broadcast Test] Media file saved to ${savedPath} (${totalBytes} bytes)`);
      res.json({ success: true, fileId, filename: safeName, filePath: savedPath, fileSize: totalBytes });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Broadcast Test] Failed to store media file: ${msg}`);
      res.status(500).json({ error: `儲存測試媒體檔案失敗: ${msg}` });
    }
  }
);

// Route: Broadcast Test - start streaming a media file or remote URL via RTP multicast
app.post('/api/broadcast/test/start', requireTeacherAuth, async (req, res) => {
  const { sourceType, source, fps, bitrateKbps, scale, quality } = req.body || {};
  const type = sourceType === 'file' || sourceType === 'url' ? sourceType : 'url';
  const src = typeof source === 'string' ? source.trim() : '';

  if (!src) {
    return res.status(400).json({ error: '請提供測試媒體來源 (本機檔案路徑或網址)' });
  }
  if (type === 'file' && !fs.existsSync(src)) {
    return res.status(400).json({ error: '測試媒體檔案不存在於伺服器，請先上傳' });
  }
  if (type === 'url' && !/^https?:\/\//i.test(src)) {
    return res.status(400).json({ error: '請提供有效的測試媒體網址 (http/https)' });
  }

  const result = await broadcastStreamer.startStream({
    sourceType: type,
    source: src,
    fps,
    bitrateKbps,
    scale,
    quality,
    localIp: activeTeacherIp,
  });
  if (!result.ok) {
    return res.status(500).json({ status: 'error', active: false, error: result.error || '廣播測試啟動失敗' });
  }
  const already = !!result.alreadyActive;
  res.json({ status: 'streaming', active: true, mode: type, alreadyActive: already });
});

// Route: Broadcast Test - stop the RTP multicast test stream
app.post('/api/broadcast/test/stop', requireTeacherAuth, (req, res) => {
  broadcastStreamer.stopStream();
  notifyStopBroadcast();
  res.json({ status: 'stopped', active: false });
});

// Route: Share URL to Student Agents (Opens Default Browser)
app.post('/api/share/url', requireTeacherAuth, (req, res) => {
  let { url, targets } = req.body || {};
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: '請提供有效的網址' });
  }

  let finalUrl = url.trim();
  if (!/^https?:\/\//i.test(finalUrl)) {
    finalUrl = 'http://' + finalUrl;
  }

  const payload = JSON.stringify({ action: 'OPEN_URL', url: finalUrl });

  let targetMacs: string[] = [];
  if (Array.isArray(targets) && targets.length > 0) {
    targetMacs = targets.map((t) => normalizeTarget(t)).filter(Boolean);
  }

  let successCount = 0;
  let totalTargets = 0;

  if (targetMacs.length === 0 || targetMacs.includes('ALL')) {
    totalTargets = agentSockets.size;
    agentSockets.forEach((ws, mac) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        successCount++;
      }
    });
  } else {
    totalTargets = targetMacs.length;
    targetMacs.forEach((mac) => {
      const ws = agentSockets.get(mac);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        successCount++;
      }
    });
  }

  const failedCount = Math.max(0, totalTargets - successCount);

  logger.info(`[Share] Shared URL "${finalUrl}" to ${successCount}/${totalTargets} student agents (${failedCount} failed/offline)`);
  res.json({
    success: true,
    count: successCount,
    totalTargets,
    successCount,
    failedCount,
    url: finalUrl,
    message: `已將網址發送至 ${successCount} 台學生機 (總目標: ${totalTargets}，失敗/離線: ${failedCount})`,
  });
});

// Route: Share File to Student Agents (Downloads to Downloads directory & opens File Explorer)
app.post(
  '/api/share/file',
  requireTeacherAuth,
  async (req, res) => {
    try {
      await ensureUploadsDirectory();

      const rawFilename = (req.headers['x-filename'] as string) || (req.query.filename as string) || 'shared_file';
      let filename = 'shared_file';
      try {
        filename = decodeURIComponent(rawFilename);
      } catch {
        filename = rawFilename;
      }
      const safeFilename = path.basename(filename).replace(/[/\\?%*:|"<>]/g, '_');

      const rawTargets = (req.headers['x-targets'] as string) || (req.query.targets as string) || '';
      let targets: string[] = [];
      if (rawTargets) {
        try {
          targets = JSON.parse(rawTargets);
        } catch {
          targets = rawTargets.split(',').map((t) => t.trim());
        }
      }

      const fileId = Date.now().toString(36) + crypto.randomBytes(16).toString('hex');
      const savedPath = path.join(UPLOADS_DIR, `${fileId}_${safeFilename}`);

      let totalBytes = 0;
      const writeStream = fs.createWriteStream(savedPath);

      await new Promise<void>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
        });
        req.pipe(writeStream);
        writeStream.on('finish', () => resolve());
        writeStream.on('error', (err) => reject(err));
        req.on('error', (err) => reject(err));
      });

      if (totalBytes === 0) {
        try { await fs.promises.unlink(savedPath); } catch {}
        return res.status(400).json({ error: '檔案內容不可為空' });
      }

      logger.info(`[Share] File saved to ${savedPath} (${totalBytes} bytes)`);

      const host = req.headers.host || `${activeTeacherIp}:${PORT}`;
      const teacherHost = (activeTeacherIp && activeTeacherIp !== '127.0.0.1') ? `${activeTeacherIp}:${PORT}` : host;
      const downloadUrl = `http://${teacherHost}/api/share/download/${fileId}/${encodeURIComponent(safeFilename)}`;

      const payload = JSON.stringify({
        action: 'SHARE_FILE',
        url: downloadUrl,
        filename: safeFilename,
        fileSize: totalBytes,
      });

      let targetMacs: string[] = [];
      if (Array.isArray(targets) && targets.length > 0) {
        targetMacs = targets.map((t) => normalizeTarget(t)).filter(Boolean);
      }

      let successCount = 0;
      let totalTargets = 0;

      if (targetMacs.length === 0 || targetMacs.includes('ALL')) {
        totalTargets = agentSockets.size;
        agentSockets.forEach((ws, mac) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
            successCount++;
          }
        });
      } else {
        totalTargets = targetMacs.length;
        targetMacs.forEach((mac) => {
          const ws = agentSockets.get(mac);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
            successCount++;
          }
        });
      }

      const failedCount = Math.max(0, totalTargets - successCount);

      logger.info(`[Share] Shared file "${safeFilename}" (${(totalBytes / 1048576).toFixed(1)} MB) to ${successCount}/${totalTargets} student agents via ${downloadUrl}`);
      res.json({
        success: true,
        count: successCount,
        totalTargets,
        successCount,
        failedCount,
        fileId,
        filename: safeFilename,
        fileSize: totalBytes,
        downloadUrl,
        message: `已將檔案 "${safeFilename}" (${(totalBytes / 1048576).toFixed(1)} MB) 發送至 ${successCount} 台學生機 (總目標: ${totalTargets}，失敗/離線: ${failedCount})`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Share] Error sharing file: ${msg}`);
      res.status(500).json({ error: `伺服器處理檔案分享失敗: ${msg}` });
    }
  }
);

// Route: Shutdown Student Agents (Triggers Countdown Modal on Student PCs)
app.post('/api/power/shutdown', requireTeacherAuth, (req, res) => {
  const { targets, timeout = 30 } = req.body || {};
  const countdown = typeof timeout === 'number' && timeout > 0 ? timeout : 30;
  const payload = JSON.stringify({ action: 'SHUTDOWN', timeout: countdown });

  let targetMacs: string[] = [];
  if (Array.isArray(targets) && targets.length > 0) {
    targetMacs = targets.map((t) => normalizeTarget(t)).filter(Boolean);
  }

  let count = 0;
  if (targetMacs.length === 0 || targetMacs.includes('ALL')) {
    agentSockets.forEach((ws, mac) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        count++;
      }
    });
  } else {
    targetMacs.forEach((mac) => {
      const ws = agentSockets.get(mac);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        count++;
      }
    });
  }

  logger.info(`[Power] Broadcasted SHUTDOWN command (timeout: ${countdown}s) to ${count} student agents`);
  res.json({
    success: true,
    count,
    timeout: countdown,
    message: `已廣播發送關機指令至 ${count} 台學生機 (倒數 ${countdown} 秒)`,
  });
});

// Route: Cancel Active Shutdown on Student Agents
app.post('/api/power/cancel-shutdown', requireTeacherAuth, (req, res) => {
  const { targets } = req.body || {};
  const payload = JSON.stringify({ action: 'CANCEL_SHUTDOWN' });

  let targetMacs: string[] = [];
  if (Array.isArray(targets) && targets.length > 0) {
    targetMacs = targets.map((t) => normalizeTarget(t)).filter(Boolean);
  }

  let count = 0;
  if (targetMacs.length === 0 || targetMacs.includes('ALL')) {
    agentSockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        count++;
      }
    });
  } else {
    targetMacs.forEach((mac) => {
      const ws = agentSockets.get(mac);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        count++;
      }
    });
  }

  logger.info(`[Power] Broadcasted CANCEL_SHUTDOWN command to ${count} student agents`);
  res.json({
    success: true,
    count,
    message: `已廣播發送取消關機指令至 ${count} 台學生機`,
  });
});

// Route: Download Shared File for Student Agents
app.get('/api/share/download/:fileId/:filename', async (req, res) => {
  const { fileId, filename } = req.params;
  // fileId is server-generated (Date.now().toString(36) + base36 random) — reject anything else
  // to prevent path traversal (e.g. "..%2F..%2F") escaping UPLOADS_DIR.
  if (!/^[a-z0-9]+$/.test(fileId)) {
    return res.status(400).json({ error: '非法的檔案識別碼' });
  }
  const safeFilename = path.basename(filename).replace(/[/\\?%*:|"<>]/g, '_');
  const filePath = path.join(UPLOADS_DIR, `${fileId}_${safeFilename}`);

  try {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
      return res.status(400).json({ error: '非法的檔案路徑' });
    }
    await fs.promises.access(resolved);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.sendFile(resolved);
  } catch {
    res.status(404).json({ error: '找不到分享之檔案' });
  }
});

// Route: Receive outbound JPEG snapshots pushed from student agents
app.post(
  '/api/agent/snapshot',
  requireAgentSnapshotAuth,
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
        const dev = discoveryService.findDevice(mac) || discoveryService.findDevice(ip);
        if (dev && winTitle) {
          dev.activeWindow = winTitle;
        }
      } catch {}
    }

    if (buffer && buffer.length > 0) {
      const entry = { buffer, timestamp: Date.now() };
      storeSnapshot(mac, entry);
      storeSnapshot(ip, entry);
      res.status(200).json({ status: 'ok' });
    } else {
      res.status(400).json({ error: 'empty snapshot' });
    }
  }
);

// Route: Serve cached JPEG snapshots to Teacher Browser UI (with WebSocket fallback for full-res)
app.get(['/api/snapshot/:id', '/api/snapshot'], requireTeacherAuth, async (req, res) => {
  pruneSnapshotCache();
  const rawId = req.params.id || (req.query.id as string) || (req.query.mac as string) || (req.query.ip as string) || '';
  const normalizedId = normalizeTarget(rawId);
  const wantsHighRes = req.query.full === '1' || req.query.highres === '1';

  if (wantsHighRes) {
    const dev = discoveryService.findDevice(rawId) || discoveryService.findDevice(normalizedId);
    const targetMac = dev ? normalizeTarget(dev.mac) : normalizedId;
    const ws = agentSockets.get(targetMac);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const b64Image = await new Promise<string>((resolve) => {
          const timer = setTimeout(() => {
            pendingHighResRequests.delete(targetMac);
            resolve('');
          }, 3000);
          pendingHighResRequests.set(targetMac, (data: string) => {
            clearTimeout(timer);
            resolve(data);
          });
          ws.send(JSON.stringify({ action: 'GET_HIGHRES_SNAPSHOT' }));
        });
        if (b64Image) {
          const buffer = Buffer.from(b64Image, 'base64');
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          return res.send(buffer);
        }
      } catch {}
    }
    return res.status(502).json({ error: 'High-resolution snapshot unavailable' });
  }

  const cachedEntry = getSnapshotCached(normalizedId) || getSnapshotCached(rawId);
  if (cachedEntry) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(cachedEntry.buffer);
  }

  res.status(404).json({ error: 'No snapshot available' });
});

// Route: Fetch/Proxy failure logs from student agent
app.get(['/api/agent/:id/logs', '/api/agent/logs'], requireTeacherAuth, async (req, res) => {
  const rawId = req.params.id || (req.query.id as string) || (req.query.mac as string) || (req.query.ip as string) || '';
  const normalizedId = normalizeTarget(rawId);

  const dev = discoveryService.findDevice(rawId) || discoveryService.findDevice(normalizedId);

  if (!dev || !dev.ip) {
    return res.status(404).json({
      error: '找不到指定的學生端裝置',
      message: `無法找到與 ID '${rawId}' 對應的學生機。`,
    });
  }

  // 1. Try fetching logs via active WebSocket reverse connection first (bypasses all firewall/port issues)
  const normMac = normalizeTarget(dev.mac);
  const ws = agentSockets.get(normMac);
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      const logs = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          pendingLogRequests.delete(normMac);
          resolve('');
        }, 2000);
        pendingLogRequests.set(normMac, (data: string) => {
          clearTimeout(timer);
          resolve(data);
        });
        ws.send(JSON.stringify({ action: 'GET_LOGS' }));
      });
      if (logs) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(logs);
      }
    } catch {}
  }

  return res.status(502).json({
    error: '無法連線至學生端抓取日誌',
    message: `目標學生機 (${dev.hostname} - ${dev.ip}) 的反向 WebSocket 未連線。`,
  });
});

// Route: One-click PowerShell installation script for Student PCs
app.get('/install-agent.ps1', async (req, res) => {
  const socketAddress = req.socket.localAddress?.replace(/^::ffff:/, '') || '';
  const candidateHost = activeTeacherIp && activeTeacherIp !== '127.0.0.1'
    ? activeTeacherIp
    : socketAddress && socketAddress !== '127.0.0.1' && socketAddress !== '::1'
      ? socketAddress
      : req.hostname;
  const teacherHost = /^[A-Za-z0-9._-]+$/.test(candidateHost) ? candidateHost : '127.0.0.1';
  const hmacSecret = await tokenAuth.getHmacSecret();
  const script = buildInstallAgentScript({
    serverHost: `${teacherHost}:${PORT}`,
    teacherHost,
    teacherPort: PORT,
    hmacSecret,
    version: APP_VERSION,
  });
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

const isExistingFile = (p: string): boolean => {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

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
    if (isExistingFile(p)) return p;
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
    if (isExistingFile(p)) return p;
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

// Route: Agent auto-update version check (no auth required for agent self-update)
app.get('/api/agent/latest-version', (req, res) => {
  const binaryPath = getAgentBinaryPath();
  const stats = binaryPath ? (() => { try { return fs.statSync(binaryPath); } catch { return null; } })() : null;
  res.json({
    version: APP_VERSION,
    downloadUrl: `/download/gs-agent.exe`,
    sizeBytes: stats?.size ?? 0,
    updatedAt: stats?.mtime?.toISOString() ?? new Date().toISOString(),
  });
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
    if (isExistingFile(p)) return p;
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
    if (isExistingFile(p)) return p;
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

async function bootstrap() {
  // 1. Interactive Multi-NIC Detection and Selection
  const nicResult = await promptSelectNic();
  activeTeacherIp = nicResult.ip;
  activeNicName = nicResult.nicName;
  const boundHost = nicResult.host || HOST;

  // 2. Start Multicast Discovery Service on selected interface & all routes
  discoveryService.start(activeTeacherIp);

  // 3. Start HTTP & WebSocket Server
  server.once('error', (err) => {
    logger.error(`[GridSight Server] HTTP/WebSocket listen failed: ${err.message}`);
    discoveryService.stop();
    process.exitCode = 1;
  });
  server.listen(PORT, boundHost, () => {
    const localUrl = `http://localhost:${PORT}`;
    const lanUrl = `http://${activeTeacherIp}:${PORT}`;

    logger.info(`=============================================================`);
    logger.info(`  🚀 GridSight Teacher Console v${APP_VERSION}`);
    logger.info(`  綁定網路卡 (NIC): ${activeNicName} (${activeTeacherIp})`);
    logger.info(`  本機控制台網址:   ${localUrl}`);
    logger.info(`  學生連線網址:     ${lanUrl}/join`);
    logger.info(`  多播動態探索:     239.255.42.99:8888`);
    logger.info(`=============================================================`);

    // 4. Auto-launch browser directly to web console
    if (!process.argv.includes('--no-open') && !process.env.NO_OPEN) {
      const targetUrl =
        activeTeacherIp && activeTeacherIp !== '127.0.0.1' && activeTeacherIp !== '0.0.0.0' ? lanUrl : localUrl;
      openBrowser(targetUrl);
    }
  });
}

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[GridSight Server] Received ${signal}; shutting down cleanly`);
  discoveryService.stop();
  broadcastStreamer.stopStream();
  for (const socket of agentSockets.values()) socket.close(1001, 'Server shutting down');
  for (const viewers of viewerSockets.values()) {
    for (const socket of viewers) socket.close(1001, 'Server shutting down');
  }
  await new Promise<void>((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
};

if (typeof __dirname !== 'undefined'
  ? process.argv[1] && (path.resolve(process.argv[1]) === path.resolve(path.join(__dirname, 'server.cjs')) || path.resolve(process.argv[1]) === path.resolve(path.join(__dirname, 'server.ts')))
  : process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  bootstrap().catch((err) => {
    logger.error(`[GridSight Server] Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
