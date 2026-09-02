import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

/*
 * GridSight Native Mouse Effect Overlay Launcher
 *
 * Launches the precompiled standalone native binary (GridSightMouseOverlay.exe / tools/mouse_overlay.cpp).
 * Architecture:
 * - Standalone Windows C++ binary with Win32 low-level mouse hook (WH_MOUSE_LL).
 * - True per-pixel alpha blending with 32-bit ARGB DIB + UpdateLayeredWindow(ULW_ALPHA).
 * - Real-time authentic Windows cursor rendering via GDI+ Bitmap::FromHICON.
 * - Non-intrusive motion ripple, click ripples (left/right/middle), and scroll indicators.
 * - Zero startup delay (0ms) and zero external runtime dependencies (.NET/PowerShell).
 */

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

export class MouseHighlightOverlay {
  private process: ChildProcess | null = null;

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
        this.process = spawn(bundledExe, [], { detached: true, stdio: 'ignore' });
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
