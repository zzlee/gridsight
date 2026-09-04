import { spawn } from 'child_process';
import { logger } from './logger.js';

/**
 * Validates whether a URL string is valid and uses http: or https: protocol.
 */
export function validateUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    // Reject shell metacharacters to prevent command injection
    const shellMetachars = /[&|;<>()^"'$`\\]/;
    if (shellMetachars.test(url)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface LaunchCommand {
  command: string;
  args: string[];
}

/**
 * Gets the OS-specific command and arguments for spawning a browser process without shell execution.
 */
export function getBrowserLaunchCommand(url: string, platform: string = process.platform): LaunchCommand | null {
  if (!validateUrl(url)) {
    return null;
  }

  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/c', 'start', '""', url],
    };
  } else if (platform === 'darwin') {
    return {
      command: 'open',
      args: [url],
    };
  } else {
    return {
      command: 'xdg-open',
      args: [url],
    };
  }
}

/**
 * Safely opens a browser to the target URL using spawn and strict URL validation.
 */
export function openBrowser(targetUrl: string, platform: string = process.platform): boolean {
  const launchCmd = getBrowserLaunchCommand(targetUrl, platform);
  if (!launchCmd) {
    logger.warn(`[Browser] ⚠️ 開啟瀏覽器失敗: 無效的網址 protocol 或格式: ${targetUrl}`);
    return false;
  }

  try {
    const child = spawn(launchCmd.command, launchCmd.args, { stdio: 'ignore', detached: true });
    child.on('error', (err) => {
      logger.warn(`[Browser] ⚠️ 開啟瀏覽器時發生錯誤: ${err.message}`);
    });
    child.unref();
    logger.info(`[Browser] 🌐 已自動開啟瀏覽器導向控制台: ${targetUrl}`);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[Browser] ⚠️ 無法啟動瀏覽器行程: ${message}`);
    return false;
  }
}
