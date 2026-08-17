# ========================================================
# GridSight Cross-Compilation Builder Image
# Provides reproducible MinGW-w64 toolchain for Windows x64
# ========================================================
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install MinGW-w64 toolchain, CMake, Make, and build essentials
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    make \
    mingw-w64 \
    g++-mingw-w64-x86-64 \
    gcc-mingw-w64-x86-64 \
    binutils-mingw-w64-x86-64 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Default command compiles gs-agent.exe for Windows x64
CMD ["make", "-C", "beacon", "CXX=x86_64-w64-mingw32-g++"]
