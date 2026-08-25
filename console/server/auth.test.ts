import crypto from 'crypto';
import { generateTeacherToken, isValidTeacherToken, teacherSessions } from './server.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

console.log('Running auth tests...\n');

// 1. Token Format and Hex Encoding Test
const { token, expiresAt } = generateTeacherToken();
assert(typeof token === 'string', 'Generated token is a string');
assert(token.length === 64, 'Token length is 64 hex characters (32 bytes)');
assert(/^[0-9a-f]{64}$/.test(token), 'Token consists only of valid lowercase hex characters');

// 2. Token Expiration Test
const expectedMinExpiry = Date.now() + 1000 * 60 * 60 * 24 * 7 - 1000;
assert(expiresAt >= expectedMinExpiry, 'Expiration timestamp is correctly set for 7 days in future');

// 3. Session Validation Test
assert(isValidTeacherToken(token) === true, 'Generated token is valid');
assert(isValidTeacherToken('invalid-token') === false, 'Arbitrary token is rejected');
assert(isValidTeacherToken(null) === false, 'Null token is rejected');
assert(isValidTeacherToken(undefined) === false, 'Undefined token is rejected');

// 4. Token Uniqueness (Entropy) Test
const generatedTokens = new Set<string>();
for (let i = 0; i < 1000; i++) {
  const t = generateTeacherToken().token;
  if (generatedTokens.has(t)) {
    assert(false, `Token #${i} is duplicate`);
  }
  generatedTokens.add(t);
}
assert(generatedTokens.size === 1000, 'All 1000 generated tokens are strictly unique');

// 5. Expired Token Handling Test
const expiredToken = 'expired_test_token_1234567890abcdef1234567890abcdef';
teacherSessions.set(expiredToken, Date.now() - 1000);
assert(isValidTeacherToken(expiredToken) === false, 'Expired token is rejected and removed from session map');
assert(teacherSessions.has(expiredToken) === false, 'Expired token removed from memory after check');

console.log('\nAll auth tests passed successfully! 🎉');
