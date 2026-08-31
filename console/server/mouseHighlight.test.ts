import { MouseHighlightOverlay, CSHARP_EFFECT_SOURCE } from './mouseHighlight.js';

console.log('Running MouseHighlightOverlay unit tests...');

// 1. Verify CSHARP_EFFECT_SOURCE content & optimization features
if (typeof CSHARP_EFFECT_SOURCE !== 'string' || CSHARP_EFFECT_SOURCE.length === 0) {
  console.error('❌ FAIL: CSHARP_EFFECT_SOURCE is not defined or empty');
  process.exit(1);
}
console.log('✅ PASS: CSHARP_EFFECT_SOURCE is non-empty string');

if (!CSHARP_EFFECT_SOURCE.includes('WM_MOUSEMOVE')) {
  console.error('❌ FAIL: CSHARP_EFFECT_SOURCE missing WM_MOUSEMOVE handling');
  process.exit(1);
}
console.log('✅ PASS: CSHARP_EFFECT_SOURCE contains WM_MOUSEMOVE handling');

if (!CSHARP_EFFECT_SOURCE.includes('MAX_CLICK_EFFECTS') || !CSHARP_EFFECT_SOURCE.includes('MAX_SCROLL_EFFECTS')) {
  console.error('❌ FAIL: CSHARP_EFFECT_SOURCE missing effect queue bounds');
  process.exit(1);
}
console.log('✅ PASS: CSHARP_EFFECT_SOURCE contains MAX_CLICK_EFFECTS and MAX_SCROLL_EFFECTS bounds');

if (!CSHARP_EFFECT_SOURCE.includes('this.Invalidate(newRect)') && !CSHARP_EFFECT_SOURCE.includes('this.Invalidate(oldRect)')) {
  console.error('❌ FAIL: CSHARP_EFFECT_SOURCE missing dirty-region Invalidate calls');
  process.exit(1);
}
console.log('✅ PASS: CSHARP_EFFECT_SOURCE contains dirty-region Invalidate calls');

if (!CSHARP_EFFECT_SOURCE.includes('_haloBrush') || !CSHARP_EFFECT_SOURCE.includes('_haloPen') || !CSHARP_EFFECT_SOURCE.includes('_scrollFont')) {
  console.error('❌ FAIL: CSHARP_EFFECT_SOURCE missing GDI object caching');
  process.exit(1);
}
console.log('✅ PASS: CSHARP_EFFECT_SOURCE contains cached GDI objects');

if (!CSHARP_EFFECT_SOURCE.includes('[MouseHighlight Stats]')) {
  console.error('❌ FAIL: CSHARP_EFFECT_SOURCE missing telemetry logging');
  process.exit(1);
}
console.log('✅ PASS: CSHARP_EFFECT_SOURCE contains performance stats logging');

// 2. Test MouseHighlightOverlay API
const overlay = new MouseHighlightOverlay();

// On non-Windows platforms (like Linux sandbox), start() returns false without error
const startResult = overlay.start();
if (process.platform === 'win32') {
  if (startResult !== true) {
    console.error('❌ FAIL: MouseHighlightOverlay.start() returned false on win32');
    process.exit(1);
  }
} else {
  if (startResult !== false) {
    console.error('❌ FAIL: MouseHighlightOverlay.start() returned true on non-win32');
    process.exit(1);
  }
}
console.log(`✅ PASS: MouseHighlightOverlay.start() returned expected result (${startResult}) for platform ${process.platform}`);

// Ensure stop() handles non-started / started state cleanly without throwing
try {
  overlay.stop();
  console.log('✅ PASS: MouseHighlightOverlay.stop() executed safely');
} catch (err) {
  console.error('❌ FAIL: MouseHighlightOverlay.stop() threw error:', err);
  process.exit(1);
}

console.log('\nAll MouseHighlightOverlay tests passed successfully! 🎉');
