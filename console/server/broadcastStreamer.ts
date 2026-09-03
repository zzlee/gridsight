import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { MouseHighlightOverlay } from './mouseHighlight.js';
import { TeacherInputRtpStreamer } from './inputRtpStreamer.js';

export const findFfmpegBinary = (): string => {
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

export type BroadcastQuality = 'high' | 'medium' | 'low';

/** Presets for the teacher screen broadcast. Applied when the caller only
 *  selects a quality level instead of tuning fps / bitrate / scale directly. */
export const QUALITY_PRESETS: Record<BroadcastQuality, { label: string; fps: number; bitrateKbps: number; scale: number }> = {
  high:   { label: '高',   fps: 30, bitrateKbps: 8000, scale: 0 },
  medium: { label: '中',   fps: 30, bitrateKbps: 4000, scale: 720 },
  low:    { label: '低',   fps: 15, bitrateKbps: 1500, scale: 480 },
};

export interface StreamerOptions {
  multicastIp?: string;
  port?: number;
  fps?: number;
  bitrateKbps?: number;
  localIp?: string;
  /** 'screen' captures the teacher display (default); 'file'/'url' stream a media source via RTP for test purposes. */
  sourceType?: 'screen' | 'file' | 'url';
  /** Convenience three-level quality preset for the screen broadcast. When set,
   *  it overrides fps / bitrateKbps / scale unless those are provided explicitly. */
  quality?: BroadcastQuality;
  /** For sourceType 'file'/'url': the local file path or remote media URL to stream. */
  source?: string;
  /** For sourceType 'file'/'url': optional max output frame height for the test stream (e.g. 720 lower decode load on student agents). Auto-fits width, preserves aspect. */
  scale?: number;
  /** Whether to synchronously record the stream into an MP4 file */
  record?: boolean;
  /** Custom destination file path for the recording */
  recordFile?: string;
  /** If true, records screen locally without sending RTP multicast packets */
  recordOnly?: boolean;
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

function findScreenCaptureBinary(): string | null {
  if (os.platform() !== 'win32') return null;
  const candidates = [
    path.resolve(process.cwd(), 'bin/GridSightScreenCapture.exe'),
    path.resolve(__dirname, '../../bin/GridSightScreenCapture.exe'),
    path.resolve(__dirname, '../bin/GridSightScreenCapture.exe'),
    path.resolve(__dirname, 'bin/GridSightScreenCapture.exe'),
    path.resolve(__dirname, 'GridSightScreenCapture.exe'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

export class TeacherBroadcastStreamer {
  private process: ChildProcess | null = null;
  private captureProcess: ChildProcess | null = null;
  private isStreaming = false;
  private killTimers = new Set<NodeJS.Timeout>();
  private currentSourceType: string = 'screen';
  private currentQuality: BroadcastQuality | null = null;
  private currentBitrateKbps: number = 0;
  private mouseOverlay = new MouseHighlightOverlay();
  private inputRtpStreamer = new TeacherInputRtpStreamer();
  private isRecording = false;
  private isRecordOnly = false;
  private currentRecordFile: string | null = null;
  private recordingStartTime: number | null = null;
  private lastSavedRecording: { filename: string; fullPath: string; durationSeconds: number; sizeBytes: number } | null = null;

  constructor() {
    this.mouseOverlay.onInputEvent((event) => {
      if (this.isStreaming) {
        this.inputRtpStreamer.sendEvent(event);
      }
    });
  }

  getMouseOverlay(): MouseHighlightOverlay {
    return this.mouseOverlay;
  }

  getInputRtpStreamer(): TeacherInputRtpStreamer {
    return this.inputRtpStreamer;
  }

  getMode(): string | null {
    return this.isStreaming ? this.currentSourceType : null;
  }

  getQuality(): BroadcastQuality | null {
    return this.isStreaming ? this.currentQuality : null;
  }

  getBitrateKbps(): number {
    return this.isStreaming ? this.currentBitrateKbps : 0;
  }

  getRecordingStatus() {
    let fileSizeBytes = 0;
    if (this.currentRecordFile) {
      try {
        fileSizeBytes = fs.statSync(this.currentRecordFile).size;
      } catch {}
    }
    return {
      isRecording: this.isRecording,
      isRecordOnly: this.isRecordOnly,
      filename: this.currentRecordFile ? path.basename(this.currentRecordFile) : null,
      fullPath: this.currentRecordFile,
      startTime: this.recordingStartTime,
      durationSeconds: this.recordingStartTime ? Math.floor((Date.now() - this.recordingStartTime) / 1000) : 0,
      fileSizeBytes,
      lastSavedRecording: this.lastSavedRecording,
    };
  }

  async toggleRecordingOnActiveStream(enable: boolean, recordingsDir?: string): Promise<boolean> {
    if (!this.isActive()) return false;
    if (this.isRecordOnly && !enable) {
      this.stopStream();
      return true;
    }
    if (this.isRecording === enable) return true;

    const currentOptions: StreamerOptions = {
      sourceType: this.currentSourceType as any,
      quality: this.currentQuality || 'high',
      bitrateKbps: this.currentBitrateKbps,
      record: enable,
      ...(enable && recordingsDir
        ? { recordFile: path.join(recordingsDir, `GridSight_Record_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mp4`) }
        : {}),
    };
    this.stopStream();
    await new Promise((r) => setTimeout(r, 200));
    const res = await this.startStream(currentOptions);
    return res.ok;
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
    // A quality preset, when selected, provides sensible defaults that can be
    // overridden by explicitly-passed fps / bitrate / scale values.
    const preset =
      options.quality && options.quality in QUALITY_PRESETS ? QUALITY_PRESETS[options.quality] : null;
    const fps = clampInt(options.fps ?? preset?.fps, 30, 1, 120);
    const bitrate = clampInt(options.bitrateKbps ?? preset?.bitrateKbps, 5000, 100, 50000);
    const presetScale = preset?.scale ?? 0;
    const scale = clampInt(options.scale ?? presetScale, 0, 144, 2160);

    let localaddr = '';
    if (options.localIp && options.localIp !== '127.0.0.1' && isLocalIp(options.localIp)) {
      localaddr = options.localIp;
    } else if (options.localIp && options.localIp !== '127.0.0.1') {
      logger.warn(`[Broadcast] Ignoring localIp ${options.localIp}: not a local interface address`);
    }

    if (options.record || options.recordOnly) {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const defaultFilename = `GridSight_Record_${timestamp}.mp4`;
      const recordDir = options.recordFile ? path.dirname(options.recordFile) : path.resolve(process.cwd(), 'data/recordings');
      try {
        fs.mkdirSync(recordDir, { recursive: true });
      } catch {}
      this.currentRecordFile = options.recordFile || path.join(recordDir, defaultFilename);
      this.isRecording = true;
      this.isRecordOnly = !!options.recordOnly;
      this.recordingStartTime = Date.now();
      logger.info(`[Broadcast/Record] Recording initiated: ${this.currentRecordFile} (recordOnly: ${this.isRecordOnly})`);
    } else {
      this.isRecording = false;
      this.isRecordOnly = false;
      this.currentRecordFile = null;
      this.recordingStartTime = null;
    }

    logger.info(
      `[Broadcast] Initiating ${options.recordOnly ? 'Screen Recording' : 'RTP Multicast Stream'} -> ${multicastIp}:${port} @ ${fps}fps (${bitrate}kbps)` +
        (scale > 0 ? `, scaled to <=${scale}p` : ', native resolution') +
        (localaddr ? ` via ${localaddr}` : '') +
        (this.isRecording ? ` [Recording to: ${this.currentRecordFile}]` : '')
    );

    let inputArgs: string[];
    const platform = os.platform();
    const sourceType = options.sourceType || 'screen';
    const mediaSource = options.source?.trim() || '';
    // Framerate/output constraints inserted after the capture/input args.
    let mediaConstraints: string[] = [];
    // Downscale helper: shared by the screen-capture and media (file/url) paths so
    // lowering quality also reduces resolution (saving bandwidth + decode load).
    const appendScale = () => {
      if (scale > 0) mediaConstraints.push('-vf', `scale=-2:${scale}`);
    };

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
      appendScale();
    } else if (platform === 'win32') {
      const captureBin = findScreenCaptureBinary();
      let captureChild: ChildProcess | null = null;
      let useCapturePipe = false;
      let screenW = 1920;
      let screenH = 1080;

      if (captureBin) {
        try {
          logger.info(`[Broadcast] Spawning Option A (In-pipeline GPU screen capturer & mouse compositor): ${captureBin}`);
          captureChild = spawn(captureBin, ['--fps', String(fps)], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });

          // Wait up to 2.5s for READY handshake from stderr
          const readyInfo = await new Promise<{ w: number; h: number; method: string } | null>((resolve) => {
            let buf = '';
            const timer = setTimeout(() => resolve(null), 2500);

            captureChild?.stderr?.on('data', (chunk: Buffer) => {
              buf += chunk.toString('utf-8');
              const lines = buf.split(/\r?\n/);
              for (const line of lines) {
                const m = line.match(/^READY\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\w+))?/);
                if (m) {
                  clearTimeout(timer);
                  resolve({ w: parseInt(m[1] ?? '0', 10), h: parseInt(m[2] ?? '0', 10), method: m[4] || 'DXGI' });
                  return;
                }
              }
            });

            captureChild?.on('error', () => {
              clearTimeout(timer);
              resolve(null);
            });
            captureChild?.on('exit', () => {
              clearTimeout(timer);
              resolve(null);
            });
          });

          if (readyInfo && captureChild && captureChild.exitCode === null) {
            screenW = readyInfo.w;
            screenH = readyInfo.h;
            useCapturePipe = true;
            this.captureProcess = captureChild;
            captureChild.on('exit', (code) => {
              if (this.isStreaming) {
                logger.warn(`[Broadcast] In-pipeline screen capturer exited (code: ${code})`);
              }
            });
            logger.info(`[Broadcast] Screen capturer ready: ${readyInfo.method} ${screenW}x${screenH} @ ${fps}fps. Piping frames directly into FFmpeg stdin.`);
          } else {
            logger.warn('[Broadcast] In-pipeline screen capturer failed to signal READY, falling back to standard gdigrab.');
            if (captureChild) {
              try { captureChild.kill(); } catch {}
              captureChild = null;
            }
          }
        } catch (err) {
          logger.warn(`[Broadcast] Error launching in-pipeline screen capturer: ${err}`);
          captureChild = null;
        }
      }

      if (useCapturePipe && this.captureProcess) {
        inputArgs = [
          '-f', 'rawvideo',
          '-pixel_format', 'bgr0',
          '-video_size', `${screenW}x${screenH}`,
          '-framerate', String(fps),
          '-i', '-',
        ];
        appendScale();
      } else {
        logger.info('[Broadcast] Using standard gdigrab desktop capture');
        inputArgs = ['-f', 'gdigrab', '-draw_mouse', '1', '-framerate', String(fps), '-i', 'desktop'];
        appendScale();
      }
    } else {
      // Linux: omit -video_size so x11grab captures the full screen at native resolution
      const display = process.env.DISPLAY || ':0';
      inputArgs = ['-f', 'x11grab', '-framerate', String(fps), '-i', display];
      appendScale();
    }

    const rtpUrl = `rtp://${multicastIp}:${port}?pkt_size=1316&ttl=2${localaddr ? `&localaddr=${localaddr}` : ''}`;
    let outputArgs: string[] = [];

    if (this.isRecordOnly && this.currentRecordFile) {
      const cleanPath = this.currentRecordFile.replace(/\\/g, '/');
      outputArgs = [
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
        '-flags', '+low_delay+global_header',
        '-f', 'mp4',
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
        cleanPath
      ];
    } else if (this.isRecording && this.currentRecordFile) {
      const cleanPath = this.currentRecordFile.replace(/\\/g, '/');
      const teeTarget = `[f=rtp]${rtpUrl}|[f=mp4:movflags=+frag_keyframe+empty_moov+default_base_moof]'${cleanPath}'`;
      outputArgs = [
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
        '-flags', '+low_delay+global_header',
        '-x264-params', 'repeat-headers=1:sliced-threads=0:force-cfr=1',
        '-f', 'tee',
        '-map', '0:v',
        teeTarget
      ];
    } else {
      outputArgs = [
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
        '-flags', '+low_delay+global_header',
        '-x264-params', 'repeat-headers=1:sliced-threads=0:force-cfr=1',
        '-f', 'rtp',
        rtpUrl
      ];
    }

    const ffmpegArgs = [
      ...inputArgs,
      ...mediaConstraints,
      ...outputArgs
    ];

    const ffmpegCmd = findFfmpegBinary();
    logger.info(`[Broadcast] Executing FFmpeg binary: ${ffmpegCmd}`);

    let child: ChildProcess;
    try {
      const stdinSource = (this.captureProcess && this.captureProcess.stdout) ? this.captureProcess.stdout : 'ignore';
      child = spawn(ffmpegCmd, ffmpegArgs, { stdio: [stdinSource, 'ignore', 'pipe'] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Broadcast] Failed to spawn FFmpeg (${ffmpegCmd}):`, msg);
      if (this.captureProcess) {
        try { this.captureProcess.kill(); } catch {}
        this.captureProcess = null;
      }
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
    this.currentBitrateKbps = bitrate;
    this.currentQuality =
      options.quality && options.quality in QUALITY_PRESETS ? options.quality : null;

    child.on('close', (code) => {
      if (this.process !== child) return;
      logger.info(`[Broadcast] Streamer process exited with code ${code}`);
      this.isStreaming = false;
      this.process = null;
      this.currentSourceType = 'screen';
      this.currentQuality = null;
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
        this.currentQuality = null;
      }
      if (this.captureProcess) {
        try { this.captureProcess.kill(); } catch {}
        this.captureProcess = null;
      }
      return { ok: false, error: reason };
    } 

    if (sourceType === 'screen' && !this.captureProcess) {
      this.mouseOverlay.start();
      this.inputRtpStreamer.start({
        ...(localaddr ? { localIp: localaddr } : {}),
        multicastIp: multicastIp,
      });
    }
    logger.info('[Broadcast] FFmpeg startup verified, streaming is live');
    return { ok: true };
  }

  stopStream() {
    const child = this.process;
    this.process = null;
    this.isStreaming = false;
    this.currentSourceType = 'screen';
    this.currentQuality = null;
    if (this.isRecording && this.currentRecordFile) {
      const durationSeconds = this.recordingStartTime ? Math.floor((Date.now() - this.recordingStartTime) / 1000) : 0;
      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(this.currentRecordFile).size;
      } catch {}
      this.lastSavedRecording = {
        filename: path.basename(this.currentRecordFile),
        fullPath: this.currentRecordFile,
        durationSeconds,
        sizeBytes,
      };
      logger.info(`[Record] Screen recording saved: ${this.currentRecordFile} (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB, ${durationSeconds}s)`);
    }
    this.isRecording = false;
    this.isRecordOnly = false;
    this.currentRecordFile = null;
    this.recordingStartTime = null;

    if (this.captureProcess) {
      try {
        this.captureProcess.kill('SIGTERM');
      } catch {}
      this.captureProcess = null;
    }

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

    this.mouseOverlay.stop();
    this.inputRtpStreamer.stop();
    logger.info('[Broadcast] Broadcast stream terminated.');
  }

  isActive() {
    return this.isStreaming && !!this.process && this.process.exitCode === null;
  }
}
