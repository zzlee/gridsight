import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { TokenAuthority } from './tokenAuthority.js';
import { MulticastDiscoveryService } from './multicastDiscovery.js';
import { TeacherBroadcastStreamer } from './broadcastStreamer.js';

const app = express();
const PORT = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3001;
const HOST = process.env.API_HOST || '0.0.0.0';

app.use(cors());
app.use(express.json());

const tokenAuth = new TokenAuthority();
const broadcastStreamer = new TeacherBroadcastStreamer();
const discoveryService = new MulticastDiscoveryService(tokenAuth, (device) => {
  console.log(`[Discovery] New Beacon: ${device.hostname} (${device.ip})`);
});

discoveryService.start();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
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

app.listen(PORT, HOST, () => {
  console.log(`[GridSight Server] Coordinator API running on http://${HOST}:${PORT}`);
});
