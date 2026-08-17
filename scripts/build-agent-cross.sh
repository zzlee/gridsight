#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if command -v docker &> /dev/null; then
    echo "=== Executing Standard Docker Builder Cross-Compilation ==="
    exec "${SCRIPT_DIR}/build-docker.sh"
else
    echo "=== Docker not found, falling back to local MinGW-w64 toolchain ==="
    if ! command -v x86_64-w64-mingw32-g++ &> /dev/null; then
        echo "Error: Neither docker nor x86_64-w64-mingw32-g++ was found on this host."
        echo "Please install Docker (recommended) or mingw-w64."
        exit 1
    fi
    cd "${ROOT_DIR}/beacon"
    make clean all CXX=x86_64-w64-mingw32-g++
    echo "=== Build Complete: beacon/gs-agent.exe ==="
    ls -lh gs-agent.exe
fi
