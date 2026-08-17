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
echo " [2/2] Cross-Compiling gs-agent.exe (MinGW-w64 Windows x64)..."
echo "===================================================================="
docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "${ROOT_DIR}:/workspace" \
    "${IMAGE_NAME}" \
    make -C beacon clean all CXX=x86_64-w64-mingw32-g++

echo ""
echo "===================================================================="
echo " ✅ Build Successful! Output artifact:"
echo "===================================================================="
ls -lh "${ROOT_DIR}/beacon/gs-agent.exe"
