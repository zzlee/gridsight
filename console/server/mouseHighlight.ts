import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';
import { type InputEventData, InputEventType } from './inputRtpStreamer.js';

/*
 * GridSight Native Mouse Effect Overlay Launcher
 *
 * Launches the precompiled standalone native binary (GridSightMouseOverlay.exe / tools/mouse_overlay.cpp).
 * Architecture:
 * - Standalone Windows C++ binary with Win32 low-level mouse hook (WH_MOUSE_LL).
 * - True per-pixel alpha blending with 32-bit ARGB DIB + UpdateLayeredWindow(ULW_ALPHA).
 * - Real-time authentic Windows cursor rendering via GDI+ Bitmap::FromHICON.
 * - Non-intrusive motion ripple, click ripples (left/right/middle), and scroll indicators.
 * - Live real mouse events piped via stdout to feed TeacherInputRtpStreamer.
 * - Zero startup delay (0ms) and zero external runtime dependencies.
 */

export type MouseInputEventListener = (event: InputEventData) => void;

export function findOverlayBinary(): string | null {
  const candidates = [
    path.join(process.cwd(), 'bin', 'GridSightMouseOverlay.exe'),
    path.join(process.cwd(), 'bin', 'gs-mouse-overlay.exe'),
    path.join(path.dirname(process.execPath), 'bin', 'GridSightMouseOverlay.exe'),
    path.join(path.dirname(process.execPath), 'GridSightMouseOverlay.exe'),
    path.join(os.tmpdir(), 'GridSightMouseOverlay.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function parseEventLine(line: string): InputEventData | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('EV ')) return null;
  const parts = trimmed.split(' ');
  if (parts.length < 9) return null;

  const eventType = parseInt(parts[1], 10);
  const normX = parseInt(parts[2], 10);
  const normY = parseInt(parts[3], 10);
  const buttonFlags = parseInt(parts[4], 10);
  const scrollDelta = parseInt(parts[5], 10);
  const modifierFlags = parseInt(parts[6], 10);
  const keyCode = parseInt(parts[7], 10);
  const timestampMs = parseInt(parts[8], 10);

  if (isNaN(eventType)) return null;

  return {
    eventType: eventType as InputEventType,
    normX: isNaN(normX) ? 0 : normX,
    normY: isNaN(normY) ? 0 : normY,
    buttonFlags: isNaN(buttonFlags) ? 0 : buttonFlags,
    scrollDelta: isNaN(scrollDelta) ? 0 : scrollDelta,
    modifierFlags: isNaN(modifierFlags) ? 0 : modifierFlags,
    keyCode: isNaN(keyCode) ? 0 : keyCode,
    timestampMs: isNaN(timestampMs) ? Date.now() : timestampMs,
  };
}

export class MouseHighlightOverlay {
  private process: ChildProcess | null = null;
  private eventListeners = new Set<MouseInputEventListener>();
  private stdoutBuffer = '';

  onInputEvent(listener: MouseInputEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  start(): boolean {
    if (os.platform() !== 'win32') {
      logger.info('[MouseHighlight] Non-Windows platform; skipping mouse effect overlay.');
      return false;
    }

    if (this.process && this.process.exitCode === null) {
      return true;
    }

    try {
      const bundledExe = findOverlayBinary();
      if (bundledExe && fs.existsSync(bundledExe)) {
        logger.info(`[MouseHighlight] Launching precompiled native mouse overlay: ${bundledExe}`);
        this.stdoutBuffer = '';
        this.process = spawn(bundledExe, ['--emit-events'], { stdio: ['ignore', 'pipe', 'ignore'] });

        this.process.stdout?.on('data', (data: Buffer) => {
          this.stdoutBuffer += data.toString('utf-8');
          const lines = this.stdoutBuffer.split(/\r?\n/);
          this.stdoutBuffer = lines.pop() ?? '';
          for (const line of lines) {
            const ev = parseEventLine(line);
            if (ev) {
              for (const listener of this.eventListeners) {
                try {
                  listener(ev);
                } catch (err) {
                  logger.warn(`[MouseHighlight] Error in input event listener: ${err}`);
                }
              }
            }
          }
        });

        return true;
      }

      logger.warn('[MouseHighlight] Native mouse overlay binary (GridSightMouseOverlay.exe) not found; skipping mouse effect overlay.');
      return false;
    } catch (err) {
      logger.warn(`[MouseHighlight] Failed to launch mouse effect overlay: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  stop() {
    this.stdoutBuffer = '';
    if (this.process) {
      try {
        if (os.platform() === 'win32' && this.process.pid) {
          spawn('taskkill', ['/F', '/PID', String(this.process.pid), '/T'], { windowsHide: true });
          spawn('taskkill', ['/F', '/IM', 'GridSightMouseOverlay.exe', '/T'], { windowsHide: true });
        }
        this.process.kill('SIGTERM');
      } catch {}
      this.process = null;
      logger.info('[MouseHighlight] Mouse effect overlay terminated.');
    }
  }

  isActive(): boolean {
    return !!this.process && this.process.exitCode === null;
  }
}
