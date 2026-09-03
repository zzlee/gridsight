import fs from 'fs';
import path from 'path';
import { writeLog, logger, closeLogger } from './logger.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    // Write directly to stdout to avoid intercepted console.log
    process.stdout.write(`✅ PASS: ${message}\n`);
  }
}

console.log('Running logger tests...\n');

// Store original console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Helper to capture console.log and console.error calls
function captureConsoleOutput(fn: () => void) {
  const logCalls: any[][] = [];
  const errorCalls: any[][] = [];

  console.log = (...args: any[]) => {
    logCalls.push(args);
  };
  console.error = (...args: any[]) => {
    errorCalls.push(args);
  };

  try {
    fn();
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }

  return { logCalls, errorCalls };
}

// 1. Test writeLog console routing and prefix formatting
{
  const { logCalls, errorCalls } = captureConsoleOutput(() => {
    writeLog('INFO', 'Test info message', 123);
  });

  assert(logCalls.length === 1, 'writeLog("INFO", ...) calls console.log once');
  assert(errorCalls.length === 0, 'writeLog("INFO", ...) does not call console.error');

  const [prefix, msg, num] = logCalls[0]!;
  const timestampRegex = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\]$/;
  assert(timestampRegex.test(prefix), 'INFO prefix contains ISO timestamp and level');
  assert(msg === 'Test info message', 'INFO log forwards string argument');
  assert(num === 123, 'INFO log forwards numeric argument');
}

{
  const { logCalls, errorCalls } = captureConsoleOutput(() => {
    writeLog('WARN', 'Warning message');
  });

  assert(logCalls.length === 1, 'writeLog("WARN", ...) calls console.log once');
  assert(errorCalls.length === 0, 'writeLog("WARN", ...) does not call console.error');
  assert(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[WARN\]$/.test(logCalls[0]![0]), 'WARN prefix formatted correctly');
  assert(logCalls[0]![1] === 'Warning message', 'WARN log forwards argument');
}

{
  const { logCalls, errorCalls } = captureConsoleOutput(() => {
    writeLog('ERROR', 'Error message occurred', { code: 500 });
  });

  assert(logCalls.length === 0, 'writeLog("ERROR", ...) does not call console.log');
  assert(errorCalls.length === 1, 'writeLog("ERROR", ...) calls console.error once');
  assert(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[ERROR\]$/.test(errorCalls[0]![0]), 'ERROR prefix formatted correctly');
  assert(errorCalls[0]![1] === 'Error message occurred', 'ERROR log forwards message');
  assert(errorCalls[0]![2]?.code === 500, 'ERROR log forwards object argument');
}

{
  const { logCalls, errorCalls } = captureConsoleOutput(() => {
    writeLog('CUSTOM', 'Custom level test');
  });

  assert(logCalls.length === 1, 'writeLog with custom level calls console.log');
  assert(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[CUSTOM\]$/.test(logCalls[0]![0]), 'Custom level prefix formatted correctly');
}

// 2. Test logger convenience object methods (info, warn, error)
{
  const { logCalls, errorCalls } = captureConsoleOutput(() => {
    logger.info('logger.info test');
    logger.warn('logger.warn test');
    logger.error('logger.error test');
  });

  assert(logCalls.length === 2, 'logger.info and logger.warn call console.log');
  assert(errorCalls.length === 1, 'logger.error calls console.error');
  assert(logCalls[0]![1] === 'logger.info test', 'logger.info forwards arguments');
  assert(logCalls[1]![1] === 'logger.warn test', 'logger.warn forwards arguments');
  assert(errorCalls[0]![1] === 'logger.error test', 'logger.error forwards arguments');
}

// 3. Test multi-argument and formatting behavior with complex objects and util.format
{
  const { logCalls } = captureConsoleOutput(() => {
    logger.info('User %s logged in with ID %d', 'alice', 42, { role: 'admin' });
  });

  assert(logCalls.length === 1, 'logger.info handles formatted args correctly');
  assert(logCalls[0]![1] === 'User %s logged in with ID %d', 'console.log receives unformatted string template');
  assert(logCalls[0]![2] === 'alice', 'console.log receives format arg 1');
  assert(logCalls[0]![3] === 42, 'console.log receives format arg 2');
  assert(logCalls[0]![4]?.role === 'admin', 'console.log receives format arg 3');
}

// 4. Test error handling when write occurs
{
  const { logCalls, errorCalls } = captureConsoleOutput(() => {
    writeLog('INFO', 'Post-stream error info log');
    writeLog('ERROR', 'Post-stream error failure log');
  });

  assert(logCalls.length === 1, 'writeLog safe execution log call');
  assert(errorCalls.length === 1, 'writeLog safe execution error call');
}

// 5. Test log rotation (Rolling Mechanism)
{
  const testLogDir = path.resolve(process.cwd(), 'temp_test_logs');
  const testLogPath = path.join(testLogDir, 'test-rotation.log');

  // Set small max size (200 bytes) and max files (2)
  process.env.LOG_FILE_PATH = testLogPath;
  process.env.LOG_MAX_SIZE = '200';
  process.env.LOG_MAX_FILES = '2';

  // Ensure clean dir
  closeLogger();
  if (fs.existsSync(testLogDir)) {
    fs.rmSync(testLogDir, { recursive: true, force: true });
  }

  captureConsoleOutput(() => {
    // Each log line is ~40-60 bytes.
    // Line 1: ~50B
    writeLog('INFO', 'Rotation message line 1 - filling up initial buffer');
    // Line 2: ~50B -> Total ~100B
    writeLog('INFO', 'Rotation message line 2 - buffer half full');
    // Line 3: ~50B -> Total ~150B
    writeLog('INFO', 'Rotation message line 3 - approaching limit');
    // Line 4: ~50B -> Total > 200B -> Triggers rotation! Main log becomes .1, new main log started.
    writeLog('INFO', 'Rotation message line 4 - triggers rotation 1');
    // Line 5 & 6 & 7 -> Triggers rotation 2! (.1 -> .2, main -> .1)
    writeLog('INFO', 'Rotation message line 5 - buffer fill');
    writeLog('INFO', 'Rotation message line 6 - buffer fill');
    writeLog('INFO', 'Rotation message line 7 - triggers rotation 2');
    // Line 8 & 9 & 10 -> Triggers rotation 3! (.2 discarded since LOG_MAX_FILES=2)
    writeLog('INFO', 'Rotation message line 8 - buffer fill');
    writeLog('INFO', 'Rotation message line 9 - buffer fill');
    writeLog('INFO', 'Rotation message line 10 - triggers rotation 3');
  });

  closeLogger();

  assert(fs.existsSync(testLogPath), 'Main log file exists after rotation');
  assert(fs.existsSync(`${testLogPath}.1`), 'Rotated log .1 exists');
  assert(fs.existsSync(`${testLogPath}.2`), 'Rotated log .2 exists');
  assert(!fs.existsSync(`${testLogPath}.3`), 'Rotated log .3 does not exist (capped at LOG_MAX_FILES=2)');

  // Clean up env and temp files
  delete process.env.LOG_FILE_PATH;
  delete process.env.LOG_MAX_SIZE;
  delete process.env.LOG_MAX_FILES;
  if (fs.existsSync(testLogDir)) {
    fs.rmSync(testLogDir, { recursive: true, force: true });
  }

  assert(true, 'Log rotation test completed successfully');
}

console.log('\nAll logger tests passed successfully! 🎉');
