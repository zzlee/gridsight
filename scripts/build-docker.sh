#!/usr/bin/env bash
# ==============================================================================
# GridSight - Standard Docker-based Cross-Compilation Script for Windows Agent
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGE_NAME="gridsight-builder:latest"

echo "===================================================================="
echo " [1/2] Preparing Docker Builder Image (${IMAGE_NAME})..."
echo "===================================================================="
docker build -t "${IMAGE_NAME}" -f "${ROOT_DIR}/Dockerfile.builder" "${ROOT_DIR}"

echo ""
echo "===================================================================="
echo " [2/2] Cross-Compiling Native Binaries (gs-agent, MouseOverlay, ScreenCapture)..."
echo "===================================================================="
mkdir -p "${ROOT_DIR}/bin"
docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "${ROOT_DIR}:/workspace" \
    "${IMAGE_NAME}" \
    bash -c "make -C beacon clean all CXX=x86_64-w64-mingw32-g++ && x86_64-w64-mingw32-g++ -O2 -mwindows -static -static-libgcc -static-libstdc++ tools/mouse_overlay.cpp -luser32 -o bin/GridSightMouseOverlay.exe && x86_64-w64-mingw32-g++ -O3 -std=c++17 -mwindows -static -static-libgcc -static-libstdc++ tools/screen_capture.cpp -ld3d11 -ldxgi -lgdi32 -lgdiplus -luser32 -lwinmm -o bin/GridSightScreenCapture.exe"

echo ""
echo "===================================================================="
echo " ✅ Build Successful! Output artifacts:"
echo "===================================================================="
ls -lh "${ROOT_DIR}/beacon/gs-agent.exe"
ls -lh "${ROOT_DIR}/bin/GridSightMouseOverlay.exe"
ls -lh "${ROOT_DIR}/bin/GridSightScreenCapture.exe"
