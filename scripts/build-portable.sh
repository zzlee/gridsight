#!/usr/bin/env bash
#
# One-command full build for the Windows zero-Defender portable bundle.
#
#   ./scripts/build-portable.sh
#   # or: npm run build:portable:full
#
# Automates every prerequisite of scripts/build-windows-portable.js:
#   1. Install console (frontend) npm dependencies
#   2. Install console/server (backend) npm dependencies
#   3. Cross-compile beacon/gs-agent.exe first if it is missing (via Docker builder)
#   4. Run the official portable packager
#
# Output:
#   release/gridsight-console-windows/   (staging folder)
#   release/gridsight-console-portable.zip
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==============================================================="
echo "  🚀 GridSight Portable Bundle - Full One-Command Build"
echo "==============================================================="

echo "[1/4] 📦 Installing console (frontend) npm dependencies..."
npm install --prefix console

echo "[2/4] 📦 Installing console/server (backend) npm dependencies..."
npm install --prefix console/server

echo "[3/4] 🎯 Checking student agent beacon/gs-agent.exe..."
if [[ ! -f "beacon/gs-agent.exe" ]]; then
    echo "      beacon/gs-agent.exe not found - cross-compiling via Docker builder..."
    if command -v docker >/dev/null 2>&1; then
        ./scripts/build-docker.sh
    else
        echo "      ⚠️  Docker not available; skip agent build."
        echo "      ⚠️  The packager will omit gs-agent.exe (install prerequisite manually via ./scripts/build-docker.sh)."
    fi
else
    echo "      ✅ beacon/gs-agent.exe found."
fi

echo "[4/4] 📦 Running portable packager (scripts/build-windows-portable.js)..."
node scripts/build-windows-portable.js

echo ""
echo "✅ Done! Bundle ready: release/gridsight-console-portable.zip"