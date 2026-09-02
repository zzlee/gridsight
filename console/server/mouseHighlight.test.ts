import { MouseHighlightOverlay, findOverlayBinary } from './mouseHighlight.js';

console.log('Running MouseHighlightOverlay unit tests...');

// 1. Test findOverlayBinary helper
if (typeof findOverlayBinary !== 'function') {
  console.error('❌ FAIL: findOverlayBinary is not exported or not a function');
  process.exit(1);
}
const detectedBinary = findOverlayBinary();
console.log(`✅ PASS: findOverlayBinary() executed safely (result: ${detectedBinary ?? 'none found (expected in Linux)'})`);

// 2. Test MouseHighlightOverlay instance API
const overlay = new MouseHighlightOverlay();

if (overlay.isActive() !== false) {
  console.error('❌ FAIL: MouseHighlightOverlay.isActive() should be false initially');
  process.exit(1);
}
console.log('✅ PASS: MouseHighlightOverlay.isActive() is false initially');

// On non-Windows platforms (like Linux sandbox), start() returns false without error
const startResult = overlay.start();
if (process.platform === 'win32') {
  console.log(`✅ PASS: MouseHighlightOverlay.start() returned ${startResult} on win32`);
} else {
  if (startResult !== false) {
    console.error('❌ FAIL: MouseHighlightOverlay.start() returned true on non-win32');
    process.exit(1);
  }
  console.log(`✅ PASS: MouseHighlightOverlay.start() returned expected result (false) for platform ${process.platform}`);
}

// Ensure stop() handles non-started / started state cleanly without throwing
try {
  overlay.stop();
  console.log('✅ PASS: MouseHighlightOverlay.stop() executed safely');
} catch (err) {
  console.error('❌ FAIL: MouseHighlightOverlay.stop() threw error:', err);
  process.exit(1);
}

if (overlay.isActive() !== false) {
  console.error('❌ FAIL: MouseHighlightOverlay.isActive() should be false after stop()');
  process.exit(1);
}
console.log('✅ PASS: MouseHighlightOverlay.isActive() is false after stop()');

console.log('\nAll MouseHighlightOverlay tests passed successfully! 🎉');
