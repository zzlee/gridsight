import fs from 'fs';
import path from 'path';
import util from 'util';

const logFilePath = process.env.LOG_FILE_PATH || path.resolve(process.cwd(), 'gridsight-server.log');
let logStream: fs.WriteStream | null = null;

logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
logStream.on('error', (error) => {
  console.error(`[ERROR] Failed to open log file at ${logFilePath}:`, error);
  logStream = null;
});

function writeLog(level: string, ...args: any[]) {
  const timestamp = new Date().toISOString();

  // Format the message for console output
  const prefix = `[${timestamp}] [${level}]`;

  // Also write to log file if available
  if (logStream) {
    const formattedArgs = util.format(...args);
    logStream.write(`${prefix} ${formattedArgs}\n`);
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
