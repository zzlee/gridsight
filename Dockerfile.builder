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

# Set default MinGW-w64 compiler to POSIX thread model for C++11 std::thread / std::mutex support
RUN update-alternatives --set x86_64-w64-mingw32-gcc /usr/bin/x86_64-w64-mingw32-gcc-posix && \
    update-alternatives --set x86_64-w64-mingw32-g++ /usr/bin/x86_64-w64-mingw32-g++-posix

WORKDIR /workspace

# Default command compiles gs-agent.exe for Windows x64
CMD ["make", "-C", "beacon", "CXX=x86_64-w64-mingw32-g++"]
