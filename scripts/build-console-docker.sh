#!/usr/bin/env bash
# ==============================================================================
# GridSight - Standard Docker Builder Script for Teacher Console
# Builds frontend & backend into a unified, reproducible production container
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGE_NAME="gridsight-console:latest"

echo "===================================================================="
echo " [1/2] Building Teacher Console via Docker Builder (${IMAGE_NAME})..."
echo "===================================================================="
docker build -t "${IMAGE_NAME}" -f "${ROOT_DIR}/Dockerfile.console" "${ROOT_DIR}"

echo ""
echo "===================================================================="
echo " [2/2] Extracting Reproducible dist/ Assets to Local Workspace..."
echo "===================================================================="
CONTAINER_ID=$(docker create "${IMAGE_NAME}")
mkdir -p "${ROOT_DIR}/console/dist"
docker cp "${CONTAINER_ID}:/app/console/dist/." "${ROOT_DIR}/console/dist/"
docker rm "${CONTAINER_ID}" > /dev/null

echo ""
echo "===================================================================="
echo " ✅ Teacher Console Docker Build Successful!"
echo "    - Docker Image:  ${IMAGE_NAME}"
echo "    - Web Bundle:    console/dist/"
echo "===================================================================="
