import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { TokenAuthority } from './tokenAuthority.js';
import { MulticastDiscoveryService } from './multicastDiscovery.js';
import { TeacherBroadcastStreamer } from './broadcastStreamer.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

app.get('/api/agents', (req, res) => {
  res.json({
    agents: discoveryService.getDevices(),
    count: discoveryService.getDevices().length,
  });
});

app.get('/api/devices', (req, res) => {
  res.json({
    devices: discoveryService.getDevices(),
    count: discoveryService.getDevices().length,
  });
});

app.post('/api/broadcast/start', (req, res) => {
  broadcastStreamer.startStream(req.body);
  res.json({ status: 'streaming', active: true });
});

app.post('/api/broadcast/stop', (req, res) => {
  broadcastStreamer.stopStream();
  res.json({ status: 'stopped', active: false });
});

app.get('/api/broadcast/status', (req, res) => {
  res.json({ active: broadcastStreamer.isActive() });
});

// Serve frontend dist assets if present
const staticDistPath = process.env.STATIC_DIR || path.resolve(__dirname, '../dist');
if (fs.existsSync(staticDistPath)) {
  app.use(express.static(staticDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(staticDistPath, 'index.html'));
  });
  logger.info(`[GridSight Server] Serving web console UI from ${staticDistPath}`);
}

app.listen(PORT, HOST, () => {
  logger.info(`[GridSight Server] Coordinator API running on http://${HOST}:${PORT}`);
});
