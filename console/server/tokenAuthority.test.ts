import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { TokenAuthority } from './tokenAuthority.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log('Running TokenAuthority tests...\n');

// 1. generateToken, getToken, validateToken basic functionality
const auth = new TokenAuthority();
const mac1: string = 'AA:BB:CC:DD:EE:FF';
const ip1 = '192.168.1.50';

assert(auth.getToken(mac1) === undefined, 'getToken returns undefined for ungenerated MAC');
assert(auth.validateToken(mac1, 'invalid_token') === false, 'validateToken returns false for ungenerated MAC');

const token1 = auth.generateToken(mac1, ip1);
assert(typeof token1 === 'string' && token1.length === 48, 'generateToken returns 48-char hex string (24 bytes)');
assert(auth.getToken(mac1) === token1, 'getToken returns generated token for MAC');
assert(auth.validateToken(mac1, token1) === true, 'validateToken returns true for correct MAC and token');
assert(auth.validateToken(mac1, 'wrong_token') === false, 'validateToken returns false for wrong token');

// Re-generating for same MAC should return existing token
const token1Reuse = auth.generateToken(mac1, ip1);
assert(token1Reuse === token1, 'generateToken reuses existing token for same MAC');

// Different MAC gets different token
const mac2: string = '11:22:33:44:55:66';
const ip2 = '192.168.1.51';
const token2 = auth.generateToken(mac2, ip2);
assert(token2 !== token1, 'generateToken creates distinct tokens for different MACs');
assert(auth.validateToken(mac2, token2) === true, 'validateToken returns true for second MAC');
assert(mac1 !== mac2 && auth.validateToken(mac1, token2) === false, 'validateToken isolates MAC addresses');

// 2. Token expiration tests
const realDateNow = Date.now;
try {
  const baseTime = Date.now();
  Date.now = () => baseTime;

  const authExp = new TokenAuthority();
  const macExp = '00:11:22:33:44:55';
  const tokenExp = authExp.generateToken(macExp, '192.168.1.60');

  // Before expiration (e.g. 2 hours later)
  Date.now = () => baseTime + 1000 * 60 * 60 * 2;
  assert(authExp.getToken(macExp) === tokenExp, 'getToken valid before 3 hours expiration');
  assert(authExp.validateToken(macExp, tokenExp) === true, 'validateToken true before expiration');

  // Exactly or after expiration (3 hours + 1 ms)
  Date.now = () => baseTime + 1000 * 60 * 60 * 3 + 1;
  assert(authExp.getToken(macExp) === undefined, 'getToken returns undefined after 3 hours expiration');
  assert(authExp.validateToken(macExp, tokenExp) === false, 'validateToken returns false after expiration');
} finally {
  Date.now = realDateNow;
}

async function main() {
  // 3. getHmacSecret tests
  const tempDataDir = path.resolve(process.cwd(), 'temp_test_data_' + Date.now());
  try {
    const authSecret = new TokenAuthority();
    const secret1 = await authSecret.getHmacSecret(tempDataDir);
    assert(typeof secret1 === 'string' && secret1.length === 64, 'getHmacSecret returns 64-char hex secret (32 bytes)');

    // Reading again should return cached in-memory secret
    const secret1Cached = await authSecret.getHmacSecret(tempDataDir);
    assert(secret1Cached === secret1, 'getHmacSecret returns cached secret on subsequent calls');

    // Verify secret file persisted on disk
    const secretFilePath = path.join(tempDataDir, 'hmac_secret.txt');
    assert(fs.existsSync(secretFilePath), 'getHmacSecret persists secret file to dataDir');
    const fileContent = fs.readFileSync(secretFilePath, 'utf-8').trim();
    assert(fileContent === secret1, 'Persisted secret file content matches generated secret');

    // A new TokenAuthority instance using the same dataDir should read from disk
    const authSecret2 = new TokenAuthority();
    const secret2 = await authSecret2.getHmacSecret(tempDataDir);
    assert(secret2 === secret1, 'New TokenAuthority instance loads existing secret from file');
  } finally {
    if (fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  }

  // 4. getHmacSecret fallback on read/write errors
  const authFallback = new TokenAuthority();
  // Invalid directory path to trigger write error
  const invalidDir = path.resolve(process.cwd(), '\0invalid_path');
  const fallbackSecret = await authFallback.getHmacSecret(invalidDir);
  assert(typeof fallbackSecret === 'string' && fallbackSecret.length === 64, 'getHmacSecret handles filesystem errors gracefully and returns secret');

  // 5. signTokenGrant tests
  const tempDataDirSign = path.resolve(process.cwd(), 'temp_test_data_sign_' + Date.now());
  try {
    const authSign = new TokenAuthority();
    const testToken = 'abcd1234efgh5678';
    const testMac = 'AA:BB:CC:11:22:33';
    const expectedSecret = await authSign.getHmacSecret(tempDataDirSign);
    const signature = await authSign.signTokenGrant(testToken, testMac);
    const expectedSig = crypto
      .createHmac('sha256', expectedSecret)
      .update(testToken + '|' + testMac)
      .digest('hex');

    assert(signature === expectedSig, 'signTokenGrant computes correct HMAC-SHA256 signature');
    assert((await authSign.signTokenGrant(testToken, testMac)) === signature, 'signTokenGrant produces deterministic signature');
    assert((await authSign.signTokenGrant('otherToken', testMac)) !== signature, 'signTokenGrant produces different signature for different token');
  } finally {
    if (fs.existsSync(tempDataDirSign)) {
      fs.rmSync(tempDataDirSign, { recursive: true, force: true });
    }
  }

  console.log('\nAll TokenAuthority tests passed successfully! 🎉');
}

main().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
