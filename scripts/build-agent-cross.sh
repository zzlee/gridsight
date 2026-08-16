#!/usr/bin/env bash
set -e

echo "=== Compiling GridSight Beacon (gs-agent.exe) via MinGW-w64 ==="
cd "$(dirname "$0")/../beacon"

if ! command -v x86_64-w64-mingw32-g++ &> /dev/null; then
    echo "Error: x86_64-w64-mingw32-g++ not found. Please install mingw-w64."
    exit 1
fi

make clean
make CXX=x86_64-w64-mingw32-g++ -j$(nproc)

echo "=== Build Complete: beacon/gs-agent.exe ==="
ls -lh gs-agent.exe
