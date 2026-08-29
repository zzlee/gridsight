import fs from 'fs';
import path from 'path';
import util from 'util';

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_FILES = 3;

let fd: number | null = null;
let currentLogFilePath = '';
let currentSize = 0;

function getMaxSizeBytes(): number {
  const envVal = process.env.LOG_MAX_SIZE;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_SIZE;
}

function getMaxFiles(): number {
  const envVal = process.env.LOG_MAX_FILES;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_MAX_FILES;
}

export function getLogFilePath(): string {
  return process.env.LOG_FILE_PATH || path.resolve(process.cwd(), 'gridsight-server.log');
}

export function closeLogger() {
  if (fd !== null) {
    try {
      fs.closeSync(fd);
    } catch {}
    fd = null;
  }
}

export function openLogFile(filePath: string = getLogFilePath()) {
  closeLogger();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      currentSize = stats.size;
    } else {
      currentSize = 0;
    }
    fd = fs.openSync(filePath, 'a');
    currentLogFilePath = filePath;
  } catch (error) {
    console.error(`[ERROR] Failed to open log file at ${filePath}:`, error);
    fd = null;
  }
}

export function rotateLogs() {
  const filePath = getLogFilePath();
  const maxFiles = getMaxFiles();

  closeLogger();

  if (maxFiles > 0) {
    for (let i = maxFiles; i >= 1; i--) {
      const target = `${filePath}.${i}`;
      const source = i === 1 ? filePath : `${filePath}.${i - 1}`;

      if (fs.existsSync(source)) {
        try {
          if (fs.existsSync(target)) {
            fs.unlinkSync(target);
          }
          fs.renameSync(source, target);
        } catch (err) {
          console.error(`[ERROR] Log rotation failed for ${source} -> ${target}:`, err);
        }
      }
    }
  } else {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`[ERROR] Log truncation failed for ${filePath}:`, err);
    }
  }

  openLogFile(filePath);
}

export function writeLog(level: string, ...args: any[]) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;

  const targetFilePath = getLogFilePath();
  if (fd === null || targetFilePath !== currentLogFilePath) {
    openLogFile(targetFilePath);
  }

  if (fd !== null) {
    const formattedArgs = util.format(...args);
    const logLine = `${prefix} ${formattedArgs}\n`;
    const lineSize = Buffer.byteLength(logLine, 'utf-8');
    const maxSizeBytes = getMaxSizeBytes();

    if (currentSize > 0 && currentSize + lineSize > maxSizeBytes) {
      rotateLogs();
    }

    if (fd !== null) {
      try {
        fs.writeSync(fd, logLine);
        currentSize += lineSize;
      } catch (err) {
        console.error(`[ERROR] Failed to write to log file at ${currentLogFilePath}:`, err);
      }
    }
  }

  if (level === 'ERROR') {
    console.error(prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }
}

export const logger = {
  info: (...args: any[]) => writeLog('INFO', ...args),
  warn: (...args: any[]) => writeLog('WARN', ...args),
  error: (...args: any[]) => writeLog('ERROR', ...args),
};
