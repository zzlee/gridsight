import assert from 'node:assert/strict';
import { buildInstallAgentScript } from './installerScript.js';

const script = buildInstallAgentScript({
  serverHost: '192.168.50.10:3000',
  teacherHost: '192.168.50.10',
  teacherPort: 3000,
    version: '5.9.0',
});

assert.match(script, /\$envPath = "\$destDir\\\.env"/);
assert.doesNotMatch(script, /gs-agent\.env/);
assert.doesNotMatch(script, /HMAC_SECRET/);
assert.match(script, /"TEACHER_HOST=192\.168\.50\.10"/);
assert.match(script, /"TEACHER_PORT=3000"/);
assert.doesNotMatch(script, /TEACHER_(?:HOST|IP)=192\.168\.50\.10:3000/);
assert.match(script, /Set-Content -Path \$envPath -Value \$configLines -Encoding ASCII/);
assert.match(script, /Start-Process -FilePath \$destPath -WorkingDirectory \$destDir/);

assert.throws(
  () => buildInstallAgentScript({
    serverHost: 'teacher\"; calc.exe; #',
    teacherHost: 'teacher',
    teacherPort: 3000,
    version: '5.8.4',
  }),
  /Unsafe serverHost/
);

console.log('Installer script tests passed');
