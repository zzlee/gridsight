#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const consoleDir = path.resolve(rootDir, 'console');
const releaseDir = path.resolve(rootDir, 'release');
const stagingDir = path.resolve(rootDir, 'release-staging');

console.log('===============================================================');
console.log('  🚀 GridSight Teacher Console Windows EXE Packager');
console.log('===============================================================');

// 1. Ensure release and staging directories exist
if (!fs.existsSync(releaseDir)) fs.mkdirSync(releaseDir, { recursive: true });
if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

// 2. Build Frontend
console.log('[1/4] 📦 Compiling Frontend (React + Vite)...');
execSync('npm run build', { cwd: consoleDir, stdio: 'inherit' });

// 3. Bundle Backend Server with esbuild into CommonJS
console.log('[2/4] ⚙️  Bundling Backend Server with esbuild...');
const serverSrc = path.resolve(consoleDir, 'server/server.ts');
const serverBundleOut = path.resolve(stagingDir, 'server.cjs');
execSync(`npx -y esbuild "${serverSrc}" --bundle --platform=node --target=node18 --outfile="${serverBundleOut}" --format=cjs`, {
  cwd: rootDir,
  stdio: 'inherit',
});

// 4. Copy static assets to staging
console.log('[3/4] 📂 Staging frontend dist & assets...');
const distSrc = path.resolve(consoleDir, 'dist');
const distDest = path.resolve(stagingDir, 'dist');
fs.cpSync(distSrc, distDest, { recursive: true });

// Copy mock_agents.py if present
const toolsSrc = path.resolve(rootDir, 'tools');
if (fs.existsSync(toolsSrc)) {
  fs.cpSync(toolsSrc, path.resolve(stagingDir, 'tools'), { recursive: true });
}

// Copy gs-agent.exe if present
const agentSrc = path.resolve(rootDir, 'beacon/gs-agent.exe');
if (fs.existsSync(agentSrc)) {
  const beaconDest = path.resolve(stagingDir, 'beacon');
  if (!fs.existsSync(beaconDest)) fs.mkdirSync(beaconDest, { recursive: true });
  fs.copyFileSync(agentSrc, path.resolve(beaconDest, 'gs-agent.exe'));
}

// Create staging package.json for pkg
const stagingPackageJson = {
  name: 'gridsight-console',
  version: '5.6.0',
  bin: 'server.cjs',
  main: 'server.cjs',
  pkg: {
    scripts: ['server.cjs'],
    assets: [
      'dist/**/*',
      'tools/**/*',
      'beacon/**/*',
    ],
  },
};
fs.writeFileSync(path.resolve(stagingDir, 'package.json'), JSON.stringify(stagingPackageJson, null, 2), 'utf-8');

// 5. Package into standalone Windows .exe with pkg
console.log('[4/4] 🔨 Generating Standalone Windows Executable (gs-console.exe)...');
const outputExe = path.resolve(releaseDir, 'gs-console.exe');

try {
  execSync(`npx -y pkg@5.8.1 "${stagingDir}" --targets node18-win-x64 --output "${outputExe}" --compress GZip`, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  const stats = fs.statSync(outputExe);
  console.log('===============================================================');
  console.log(`  ✅ SUCCESS! Windows Standalone Binary generated:`);
  console.log(`     Path: ${outputExe}`);
  console.log(`     Size: ${(stats.size / 1048576).toFixed(2)} MB`);
  console.log('===============================================================');
} catch (err) {
  console.error('Packaging failed:', err);
  process.exit(1);
}
