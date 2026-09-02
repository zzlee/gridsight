import { MouseHighlightOverlay, findOverlayBinary, parseEventLine } from './mouseHighlight.js';
import { InputEventType } from './inputRtpStreamer.js';

console.log('Running MouseHighlightOverlay unit tests...');

// 1. Test findOverlayBinary helper
if (typeof findOverlayBinary !== 'function') {
  console.error('❌ FAIL: findOverlayBinary is not exported or not a function');
  process.exit(1);
}
const detectedBinary = findOverlayBinary();
console.log(`✅ PASS: findOverlayBinary() executed safely (result: ${detectedBinary ?? 'none found (expected in Linux)'})`);

// 2. Test parseEventLine parser
const validLine = 'EV 1 32768 16384 1 120 2 65 1700000000000';
const parsed = parseEventLine(validLine);
if (!parsed) {
  console.error('❌ FAIL: parseEventLine returned null for valid EV line');
  process.exit(1);
}
if (
  parsed.eventType !== InputEventType.MouseMove ||
  parsed.normX !== 32768 ||
  parsed.normY !== 16384 ||
  parsed.buttonFlags !== 1 ||
  parsed.scrollDelta !== 120 ||
  parsed.modifierFlags !== 2 ||
  parsed.keyCode !== 65 ||
  parsed.timestampMs !== 1700000000000
) {
  console.error('❌ FAIL: parseEventLine field values mismatch:', parsed);
  process.exit(1);
}
console.log('✅ PASS: parseEventLine correctly parses valid EV event line');

// Test invalid lines
if (parseEventLine('') !== null || parseEventLine('NOT_AN_EVENT') !== null || parseEventLine('EV 1 2') !== null) {
  console.error('❌ FAIL: parseEventLine should return null for malformed lines');
  process.exit(1);
}
console.log('✅ PASS: parseEventLine safely rejects malformed lines');

// 3. Test onInputEvent listener lifecycle
const overlay = new MouseHighlightOverlay();
let receivedEvent: any = null;
const unsubscribe = overlay.onInputEvent((ev) => {
  receivedEvent = ev;
});

// Simulate an event parsed from line
const sample = parseEventLine('EV 2 100 200 1 0 0 0 1700000000001');
if (sample) {
  // @ts-ignore trigger internal listeners for testing
  for (const listener of (overlay as any).eventListeners) {
    listener(sample);
  }
}
if (!receivedEvent || receivedEvent.eventType !== InputEventType.MouseDown || receivedEvent.normX !== 100) {
  console.error('❌ FAIL: onInputEvent listener did not receive event correctly');
  process.exit(1);
}
console.log('✅ PASS: onInputEvent listener receives forwarded events');

unsubscribe();
receivedEvent = null;
if (sample) {
  for (const listener of (overlay as any).eventListeners) {
    listener(sample);
  }
}
if (receivedEvent !== null) {
  console.error('❌ FAIL: onInputEvent listener was not unsubscribed');
  process.exit(1);
}
console.log('✅ PASS: onInputEvent unsubscribe works cleanly');

// 4. Test MouseHighlightOverlay instance API
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
