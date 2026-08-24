import { validateUrl, getBrowserLaunchCommand, openBrowser } from './browserLauncher.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log('Running browserLauncher tests...\n');

// 1. URL Validation Tests
assert(validateUrl('http://localhost:3000') === true, 'Valid http://localhost:3000');
assert(validateUrl('https://localhost:3000') === true, 'Valid https://localhost:3000');
assert(validateUrl('http://192.168.1.100:3000') === true, 'Valid IP address HTTP URL');
assert(validateUrl('https://example.com/path?arg=value') === true, 'Valid domain HTTPS URL with query params');

// Rejections
assert(validateUrl('javascript:alert(1)') === false, 'Reject javascript: protocol');
assert(validateUrl('file:///etc/passwd') === false, 'Reject file: protocol');
assert(validateUrl('data:text/html,<h1>test</h1>') === false, 'Reject data: protocol');
assert(validateUrl('ftp://example.com') === false, 'Reject ftp: protocol');
assert(validateUrl('') === false, 'Reject empty string');
assert(validateUrl('not_a_url') === false, 'Reject malformed string');
assert(validateUrl('http://') === false, 'Reject incomplete URL');
assert(validateUrl('http://localhost:3000" & calc.exe') === false, 'Reject invalid URL characters');

// 2. Command Construction Tests
// win32
const winCmd = getBrowserLaunchCommand('http://localhost:3000', 'win32');
assert(winCmd !== null, 'win32 command is non-null for valid URL');
assert(winCmd?.command === 'cmd.exe', 'win32 executable is cmd.exe');
assert(
  JSON.stringify(winCmd?.args) === JSON.stringify(['/c', 'start', '""', 'http://localhost:3000']),
  'win32 args correctly formed as array'
);

// darwin (macOS)
const macCmd = getBrowserLaunchCommand('http://localhost:3000', 'darwin');
assert(macCmd !== null, 'darwin command is non-null for valid URL');
assert(macCmd?.command === 'open', 'darwin executable is open');
assert(
  JSON.stringify(macCmd?.args) === JSON.stringify(['http://localhost:3000']),
  'darwin args correctly formed as array'
);

// linux
const linuxCmd = getBrowserLaunchCommand('http://localhost:3000', 'linux');
assert(linuxCmd !== null, 'linux command is non-null for valid URL');
assert(linuxCmd?.command === 'xdg-open', 'linux executable is xdg-open');
assert(
  JSON.stringify(linuxCmd?.args) === JSON.stringify(['http://localhost:3000']),
  'linux args correctly formed as array'
);

// Invalid URL returns null command
assert(
  getBrowserLaunchCommand('javascript:alert(1)', 'win32') === null,
  'getBrowserLaunchCommand returns null for invalid protocol on win32'
);

// 3. openBrowser rejection test
assert(
  openBrowser('javascript:alert(1)', 'linux') === false,
  'openBrowser returns false for invalid protocol'
);

console.log('\nAll browserLauncher tests passed successfully! 🎉');
