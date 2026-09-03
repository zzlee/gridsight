import { execFile } from 'node:child_process';
import os from 'node:os';
import { logger } from './logger.js';
import { findFfmpegBinary } from './broadcastStreamer.js';

export interface AudioDevice {
  id: string;
  name: string;
  isDefault?: boolean;
}

let cachedDevices: AudioDevice[] | null = null;
let lastScanTime = 0;
const CACHE_TTL_MS = 15000;

export function parseDshowAudioDevices(output: string): string[] {
  const lines = output.split(/\r?\n/);
  let inAudio = false;
  const devices: string[] = [];
  for (const line of lines) {
    if (/DirectShow audio devices/i.test(line)) {
      inAudio = true;
      continue;
    }
    if (inAudio) {
      if (/DirectShow (?:video|other) devices/i.test(line)) {
        inAudio = false;
        continue;
      }
      if (/Alternative name/i.test(line)) continue;
      const match = line.match(/"([^"]+)"/);
      if (match && match[1]) {
        devices.push(match[1].trim());
      }
    }
  }
  return devices;
}

export function parseLinuxAudioDevices(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const devices: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // pactl list sources short: "0 alsa_output.pci-... module-alsa-card.c s16le 2ch 44100Hz RUNNING"
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[1]) {
      const name = parts[1];
      if (!name.endsWith('.monitor') || /stereo-mix/i.test(name)) {
        devices.push(name);
      }
    }
  }
  return devices;
}

export async function listAudioInputDevices(): Promise<AudioDevice[]> {
  const now = Date.now();
  if (cachedDevices && (now - lastScanTime) < CACHE_TTL_MS) {
    return cachedDevices;
  }

  const baseDevices: AudioDevice[] = [
    { id: 'none', name: '🔇 不錄製聲音（純畫面）' },
    { id: 'default', name: '🎤 系統預設音訊裝置 (Default)', isDefault: true },
  ];

  const platform = os.platform();
  const ffmpegCmd = findFfmpegBinary();

  if (platform === 'win32') {
    try {
      const dshowOutput = await new Promise<string>((resolve) => {
        execFile(ffmpegCmd, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeout: 3000 }, (_err, _stdout, stderr) => {
          resolve(stderr ? stderr.toString() : '');
        });
      });

      const parsed = parseDshowAudioDevices(dshowOutput);
      for (const devName of parsed) {
        baseDevices.push({
          id: devName,
          name: devName.toLowerCase().includes('stereo') || devName.toLowerCase().includes('mix')
            ? `🔊 ${devName} (電腦聲音)`
            : `🎙️ ${devName}`,
        });
      }
    } catch (err) {
      logger.warn('[AudioDevices] Failed to enumerate DirectShow audio devices:', err);
    }
  } else {
    // Linux: try pactl or arecord
    try {
      const pactlOutput = await new Promise<string>((resolve) => {
        execFile('pactl', ['list', 'sources', 'short'], { timeout: 2000 }, (_err, stdout) => {
          resolve(stdout ? stdout.toString() : '');
        });
      });
      const parsed = parseLinuxAudioDevices(pactlOutput);
      for (const devName of parsed) {
        baseDevices.push({
          id: devName,
          name: `🎙️ ${devName}`,
        });
      }
    } catch {
      // Ignore on Linux headless
    }
  }

  cachedDevices = baseDevices;
  lastScanTime = now;
  return baseDevices;
}
