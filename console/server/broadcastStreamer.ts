import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger.js';

export interface StreamerOptions {
  multicastIp?: string;
  port?: number;
  fps?: number;
  bitrateKbps?: number;
}

export class TeacherBroadcastStreamer {
  private process: ChildProcess | null = null;
  private isStreaming = false;

  startStream(options: StreamerOptions = {}) {
    if (this.isStreaming) return;

    const multicastIp = options.multicastIp || process.env.BROADCAST_MULTICAST_IP || '239.255.42.100';
    const port = options.port || (process.env.BROADCAST_PORT ? parseInt(process.env.BROADCAST_PORT, 10) : 9000);
    const fps = options.fps || 30;
    const bitrate = options.bitrateKbps || 5000;

    logger.info(`[Broadcast] Initiating RTP Multicast Stream -> ${multicastIp}:${port} @ ${fps}fps (${bitrate}kbps)`);

    // FFmpeg pipeline: capture X11/D3D screen, encode OpenH264/NVENC, output RTP Multicast
    const ffmpegArgs = [
      '-f', 'x11grab',
      '-video_size', '1920x1080',
      '-framerate', String(fps),
      '-i', ':0.0',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${bitrate}k`,
      '-bufsize', `${bitrate / 2}k`,
      '-pix_fmt', 'yuv420p',
      '-g', String(fps),
      '-f', 'rtp',
      `rtp://${multicastIp}:${port}?pkt_size=1316&ttl=2`
    ];

    try {
      this.process = spawn('ffmpeg', ffmpegArgs);
      this.isStreaming = true;

      this.process.stderr?.on('data', (data) => {
        // Logging / stats
      });

      this.process.on('close', (code) => {
        logger.info(`[Broadcast] Streamer exited with code ${code}`);
        this.isStreaming = false;
        this.process = null;
      });
    } catch (err) {
      logger.error('[Broadcast] Failed to spawn FFmpeg streamer:', err);
    }
  }

  stopStream() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.isStreaming = false;
    logger.info('[Broadcast] Broadcast stream terminated.');
  }

  isActive() {
    return this.isStreaming;
  }
}
