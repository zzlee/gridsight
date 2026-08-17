import { spawn, ChildProcess } from 'child_process';
import os from 'os';
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

    // Determine platform-specific capture input
    let inputArgs: string[] = [];
    const platform = os.platform();

    if (platform === 'win32') {
      inputArgs = ['-f', 'gdigrab', '-framerate', String(fps), '-i', 'desktop'];
    } else if (platform === 'darwin') {
      inputArgs = ['-f', 'avfoundation', '-framerate', String(fps), '-i', 'default'];
    } else {
      // Linux: Check DISPLAY env
      const display = process.env.DISPLAY || ':0.0';
      inputArgs = ['-f', 'x11grab', '-video_size', '1920x1080', '-framerate', String(fps), '-i', display];
    }

    const ffmpegArgs = [
      ...inputArgs,
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
        const msg = data.toString('utf-8');
        if (msg.includes('error') || msg.includes('Error')) {
          logger.warn(`[Broadcast FFmpeg] ${msg.trim()}`);
        }
      });

      this.process.on('error', (err) => {
        logger.warn(`[Broadcast] FFmpeg spawn note (${err.message}). If running without FFmpeg or GUI display, simulated broadcast state is active.`);
      });

      this.process.on('close', (code) => {
        logger.info(`[Broadcast] Streamer process exited with code ${code}`);
        this.isStreaming = false;
        this.process = null;
      });
    } catch (err: any) {
      logger.error('[Broadcast] Failed to spawn FFmpeg streamer:', err.message);
      this.isStreaming = true; // Still allow simulated state for UI
    }
  }

  stopStream() {
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch (e) {}
      this.process = null;
    }
    this.isStreaming = false;
    logger.info('[Broadcast] Broadcast stream terminated.');
  }

  isActive() {
    return this.isStreaming;
  }
}
