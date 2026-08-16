import express from 'express';
import cors from 'cors';
import { TokenAuthority } from './tokenAuthority';
import { MulticastDiscoveryService } from './multicastDiscovery';
import { TeacherBroadcastStreamer } from './broadcastStreamer';

const app = express();
const PORT = 3001;

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[GridSight Server] Coordinator API running on http://0.0.0.0:${PORT}`);
});
