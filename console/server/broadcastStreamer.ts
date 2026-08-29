import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const findFfmpegBinary = (): string => {
  if (os.platform() === 'win32') {
    const candidates = [
      path.resolve(process.cwd(), 'bin', 'ffmpeg.exe'),
      path.resolve(process.cwd(), 'ffmpeg.exe'),
      path.resolve(path.dirname(process.execPath), 'ffmpeg.exe'),
      path.resolve(path.dirname(process.execPath), 'bin', 'ffmpeg.exe'),
      path.resolve(path.dirname(process.execPath), '..', 'bin', 'ffmpeg.exe'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
  }
  return 'ffmpeg';
};

export interface StreamerOptions {
  multicastIp?: string;
  port?: number;
  fps?: number;
  bitrateKbps?: number;
  localIp?: string;
  /** 'screen' captures the teacher display (default); 'file'/'url' stream a media source via RTP for test purposes. */
  sourceType?: 'screen' | 'file' | 'url';
  /** For sourceType 'file'/'url': the local file path or remote media URL to stream. */
  source?: string;
  /** For sourceType 'file'/'url': optional max output frame height for the test stream (e.g. 720 lower decode load on student agents). Auto-fits width, preserves aspect. */
  scale?: number;
}

export interface StreamStartResult {
  ok: boolean;
  alreadyActive?: boolean;
  error?: string;
}

interface SpawnOutcome {
  exited: boolean;
  code: number | null;
  error?: string;
}

const STARTUP_PROBE_MS = 2500;
const SIGKILL_GRACE_MS = 3000;

const MULTICAST_RE = /^(22[4-9]|23\d)(\.\d{1,3}){3}$/;

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const isLocalIp = (ip: string): boolean => {
  const found: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) found.push(info.address);
  }
  return found.includes(ip);
};

const FATAL_RE = /(error|fatal|unable|failed|invalid|could not|out of range)/i;

export class TeacherBroadcastStreamer {
  private process: ChildProcess | null = null;
  private isStreaming = false;
  private killTimers = new Set<NodeJS.Timeout>();
  private currentSourceType: string = 'screen';

  getMode(): string | null {
    return this.isStreaming ? this.currentSourceType : null;
  }

  async startStream(options: StreamerOptions = {}): Promise<StreamStartResult> {
    if (this.isStreaming && this.process && this.process.exitCode === null) {
      return { ok: true, alreadyActive: true };
    }

    const multicastIp =
      typeof options.multicastIp === 'string' && MULTICAST_RE.test(options.multicastIp)
        ? options.multicastIp
        : process.env.BROADCAST_MULTICAST_IP && MULTICAST_RE.test(process.env.BROADCAST_MULTICAST_IP)
          ? process.env.BROADCAST_MULTICAST_IP
          : '239.255.42.100';
    const port = clampInt(options.port ?? process.env.BROADCAST_PORT, 9000, 1024, 65535);
    const fps = clampInt(options.fps, 30, 1, 120);
    const bitrate = clampInt(options.bitrateKbps, 5000, 100, 50000);

    let localaddr = '';
    if (options.localIp && options.localIp !== '127.0.0.1' && isLocalIp(options.localIp)) {
      localaddr = options.localIp;
    } else if (options.localIp && options.localIp !== '127.0.0.1') {
      logger.warn(`[Broadcast] Ignoring localIp ${options.localIp}: not a local interface address`);
    }

    logger.info(
      `[Broadcast] Initiating RTP Multicast Stream -> ${multicastIp}:${port} @ ${fps}fps (${bitrate}kbps)` +
        (localaddr ? ` via ${localaddr}` : '')
    );

    let inputArgs: string[];
    const platform = os.platform();
    const sourceType = options.sourceType || 'screen';
    const mediaSource = options.source?.trim() || '';
    // Framerate/output constraints inserted for the media (file/url) path only.
    let mediaConstraints: string[] = [];

    if (sourceType === 'file' || sourceType === 'url') {
      // Media broadcast test: stream a local file or remote URL over the same
      // RTP multicast group the student agents subscribe to, looped until stop.
      if (sourceType === 'file' && !fs.existsSync(mediaSource)) {
        logger.error(`[Broadcast] Test media file not found: ${mediaSource}`);
        return { ok: false, error: `測試媒體檔案不存在: ${mediaSource}` };
      }
      if (sourceType === 'url' && !/^https?:\/\//i.test(mediaSource)) {
        return { ok: false, error: '請提供有效的測試媒體網址 (http/https)' };
      }
      logger.info(`[Broadcast] Media broadcast test source (${sourceType}): ${mediaSource}`);
      // -re paces input at native frame rate; -stream_loop -1 loops forever so
      // the test keeps streaming until the teacher explicitly stops it.
      inputArgs = ['-re', '-stream_loop', '-1', '-i', mediaSource];
      // Cap output framerate so decode load on student agents stays low.
      mediaConstraints = ['-r', String(fps)];
      // Optionally downscale (typical test streams are 1080p; agents may struggle
      // to decode 1080p60 in software). Auto-fit width to preserve aspect ratio.
      const maxHeight = clampInt(options.scale, 0, 144, 2160);
      if (maxHeight > 0) mediaConstraints.push('-vf', `scale=-2:${maxHeight}`);
    } else if (platform === 'win32') {
      // macOS is not a supported platform (see docs/roadmap.md)
      inputArgs = ['-f', 'gdigrab', '-framerate', String(fps), '-i', 'desktop'];
    } else {
      // Linux: omit -video_size so x11grab captures the full screen at native resolution
      const display = process.env.DISPLAY || ':0';
      inputArgs = ['-f', 'x11grab', '-framerate', String(fps), '-i', display];
    }

    const rtpUrl = `rtp://${multicastIp}:${port}?pkt_size=1316&ttl=2${localaddr ? `&localaddr=${localaddr}` : ''}`;
    const ffmpegArgs = [
      ...inputArgs,
      ...mediaConstraints,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${bitrate}k`,
      '-bufsize', `${Math.floor(bitrate / 2)}k`,
      '-pix_fmt', 'yuv420p',
      '-g', String(fps),
      '-keyint_min', String(fps),
      '-sc_threshold', '0',
      '-slices', '1',
      '-bf', '0',
      '-flags', '+low_delay',
      '-x264-params', 'repeat-headers=1:sliced-threads=0:force-cfr=1',
      '-f', 'rtp',
      rtpUrl
    ];

    const ffmpegCmd = findFfmpegBinary();
    logger.info(`[Broadcast] Executing FFmpeg binary: ${ffmpegCmd}`);

    let child: ChildProcess;
    try {
      child = spawn(ffmpegCmd, ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Broadcast] Failed to spawn FFmpeg (${ffmpegCmd}):`, msg);
      return { ok: false, error: `無法啟動 FFmpeg: ${msg}` };
    }

    const stderrTail: string[] = [];
    child.stderr?.on('data', (data: Buffer) => {
      for (const rawLine of data.toString('utf-8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        stderrTail.push(line);
        if (stderrTail.length > 8) stderrTail.shift();
        if (FATAL_RE.test(line)) logger.warn(`[Broadcast FFmpeg] ${line}`);
      }
    });

    const describeFailure = (code: number | null, err?: string): string =>
      err ||
      stderrTail.filter((l) => FATAL_RE.test(l)).slice(-2).join(' | ') ||
      stderrTail.slice(-2).join(' | ') ||
      `FFmpeg 提前結束 (exit code ${code})`;

    const outcome = new Promise<SpawnOutcome>((resolve) => {
      child.once('close', (code) => resolve({ exited: true, code, error: describeFailure(code) }));
      child.once('error', (err) => resolve({ exited: true, code: null, error: err.message }));
    });

    this.process = child;
    this.isStreaming = true;
    this.currentSourceType = sourceType;

    child.on('close', (code) => {
      if (this.process !== child) return;
      logger.info(`[Broadcast] Streamer process exited with code ${code}`);
      this.isStreaming = false;
      this.process = null;
      this.currentSourceType = 'screen';
    });

    child.on('error', (err) => {
      if (this.process !== child) return;
      logger.warn(`[Broadcast] FFmpeg spawn error: ${err.message}`);
    });

    const result = await Promise.race<SpawnOutcome>([
      outcome,
      new Promise<SpawnOutcome>((resolve) => setTimeout(() => resolve({ exited: false, code: null }), STARTUP_PROBE_MS))
    ]);

    if (result.exited) {
      const reason = result.error || `FFmpeg 提前結束 (exit code ${result.code})`;
      logger.error(`[Broadcast] Startup failed: ${reason}`);
      if (this.process === child) {
        this.isStreaming = false;
        this.process = null;
        this.currentSourceType = 'screen';
      }
      return { ok: false, error: reason };
    } 
    logger.info('[Broadcast] FFmpeg startup verified, streaming is live');
    return { ok: true };
  }

  stopStream() {
    const child = this.process;
    this.process = null;
    this.isStreaming = false;
    this.currentSourceType = 'screen';

    if (child && child.exitCode === null) {
      try {
        child.kill('SIGTERM');
      } catch {}

      const timer = setTimeout(() => {
        this.killTimers.delete(timer);
        if (child.exitCode === null) {
          logger.warn('[Broadcast] FFmpeg did not exit after SIGTERM, sending SIGKILL');
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      }, SIGKILL_GRACE_MS);
      this.killTimers.add(timer);

      child.once('close', () => {
        clearTimeout(timer);
        this.killTimers.delete(timer);
      });
    }

    logger.info('[Broadcast] Broadcast stream terminated.');
  }

  isActive() {
    return this.isStreaming && !!this.process && this.process.exitCode === null;
  }
}
