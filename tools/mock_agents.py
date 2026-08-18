#!/usr/bin/env python3
"""
GridSight High-Concurrency Mock Agent Cluster
Simulates 70~100+ student agents on a single Windows/Linux machine with minimal CPU & RAM usage.
Used for benchmarking teacher console rendering, network multicast, and snapshot throughput.
"""

import argparse
import asyncio
import json
import random
import socket
import struct
import sys
import time
from typing import Dict, List

# Try importing PIL for realistic synthetic thumbnail generation; fallback to raw JPEG if not available
try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

def create_sample_jpeg(agent_id: int, hostname: str, width: int = 480, height: int = 270) -> bytes:
    """Generates an in-memory realistic test screen JPEG with student label and timestamp."""
    import io
    if HAS_PIL:
        # Create dark background with grid pattern
        img = Image.new('RGB', (width, height), color=(15, 23, 42)) # slate-900
        draw = ImageDraw.Draw(img)

        # Draw header bar
        draw.rectangle([(0, 0), (width, 32)], fill=(30, 41, 59)) # slate-800
        draw.rectangle([(12, 10), (24, 22)], fill=(56, 189, 248)) # sky-400

        # Draw mock application windows
        colors = [(30, 58, 138), (88, 28, 135), (20, 83, 45)]
        accent = colors[agent_id % len(colors)]
        draw.rounded_rectangle([(30, 50), (width - 30, height - 30)], radius=8, fill=(15, 23, 42), outline=accent, width=2)
        draw.rectangle([(30, 50), (width - 30, 75)], fill=accent)

        # Text information
        draw.text((36, 8), f"GridSight Mock Client - {hostname}", fill=(241, 245, 249))
        draw.text((45, 55), f"Workspace #{agent_id:02d}", fill=(255, 255, 255))
        draw.text((50, 90), f"Status: Live Streaming (Mock Source)", fill=(148, 163, 184))
        draw.text((50, 115), f"CPU: {random.randint(10, 40)}%  |  RAM: {random.randint(30, 65)}%", fill=(56, 189, 248))
        draw.text((50, 140), f"Resolution: {width}x{height} (16:9 Standard)", fill=(148, 163, 184))
        draw.text((50, height - 55), f"Time: {time.strftime('%H:%M:%S')}", fill=(100, 116, 139))

        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=75)
        return buf.getvalue()
    else:
        # Minimal valid 1x1 base JPEG if PIL is not installed
        return (
            b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00\x08\x06'
            b'\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14'
            b'\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' \",#\x1c\x1c(7),01444\x1f\'9=82<.342\xff\xc0\x00'
            b'\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01'
            b'\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda'
            b'\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9'
        )

class MockAgent:
    def __init__(self, agent_index: int, local_ip: str, base_port: int):
        self.index = agent_index
        self.port = base_port + agent_index - 1
        self.hostname = f"DESKTOP-MOCK-{self.index:02d}"
        self.username = f"Student{self.index:02d}"
        self.mac = f"00:50:56:C0:{self.index//256:02X}:{self.index%256:02X}"
        self.ip = local_ip
        self.metrics = {
            "cpu": random.randint(8, 35),
            "ram": random.randint(30, 60),
            "disk": random.randint(40, 70),
            "temp": random.randint(38, 55)
        }
        # Pre-cache JPEG in RAM for instant 0% CPU delivery
        self.jpeg_cache = create_sample_jpeg(self.index, self.hostname)

    def get_beacon_payload(self) -> dict:
        # Simulate slight dynamic fluctuation in telemetry metrics
        self.metrics["cpu"] = max(5, min(95, self.metrics["cpu"] + random.randint(-2, 2)))
        self.metrics["ram"] = max(20, min(90, self.metrics["ram"] + random.randint(-1, 1)))

        return {
            "type": "beacon",
            "hostname": self.hostname,
            "ip": self.ip,
            "port": self.port,
            "mac": self.mac,
            "username": self.username,
            "status": "idle",
            "metrics": self.metrics,
            "stream_ready": True
        }

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            line = await reader.readline()
            if not line:
                writer.close()
                return

            req_line = line.decode('utf-8', errors='ignore').strip()
            parts = req_line.split()
            if len(parts) < 2:
                writer.close()
                return

            method, path = parts[0], parts[1]

            # Read remaining HTTP headers
            while True:
                h_line = await reader.readline()
                if not h_line or h_line == b'\r\n' or h_line == b'\n':
                    break

            if path.startswith('/api/snapshot'):
                # Return pre-cached JPEG snapshot
                resp_headers = (
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Cache-Control: no-store, no-cache, must-revalidate\r\n"
                    b"Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(self.jpeg_cache)}\r\n"
                    b"Connection: close\r\n"
                    b"\r\n"
                )
                writer.write(resp_headers)
                writer.write(self.jpeg_cache)
                await writer.drain()

            elif path.startswith('/api/specs'):
                body = json.dumps({
                    "hostname": self.hostname,
                    "username": self.username,
                    "mac": self.mac,
                    "ip": self.ip,
                    "cpu_model": "Intel Core i7-12700 @ 3.60GHz (Mock)",
                    "ram_total_gb": 16,
                    "disk_total_gb": 512,
                    "gpu_model": "NVIDIA GeForce RTX 3060 12GB (Mock)",
                    "os": "Windows 11 Pro 64-bit"
                }).encode('utf-8')
                resp = (
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: application/json\r\n"
                    b"Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    b"Connection: close\r\n"
                    b"\r\n" + body
                )
                writer.write(resp)
                await writer.drain()

            elif path.startswith('/api/auth'):
                body = json.dumps({
                    "status": "ok",
                    "authenticated": True,
                    "token": f"mock-token-{self.index}-{int(time.time())}"
                }).encode('utf-8')
                resp = (
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: application/json\r\n"
                    b"Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    b"Connection: close\r\n"
                    b"\r\n" + body
                )
                writer.write(resp)
                await writer.drain()

            else:
                body = b'{"status":"ok","mock":true}'
                resp = (
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: application/json\r\n"
                    b"Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    b"Connection: close\r\n"
                    b"\r\n" + body
                )
                writer.write(resp)
                await writer.drain()

        except Exception:
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


def get_default_local_ip() -> str:
    """Finds the primary local network IP address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


async def beacon_broadcast_loop(agents: List[MockAgent], multicast_ip: str, multicast_port: int, interval: float):
    """Sends multicast UDP discovery beacons for all simulated agents."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    # Set Multicast TTL to 2 for local LAN routing
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, struct.pack('b', 2))

    print(f"[Beacon] Multicast broadcaster active -> {multicast_ip}:{multicast_port} ({len(agents)} agents, interval: {interval}s)")

    while True:
        try:
            for agent in agents:
                data = json.dumps(agent.get_beacon_payload()).encode('utf-8')
                sock.sendto(data, (multicast_ip, multicast_port))
                # Slight micro-sleep between packets to avoid UDP burst drops
                await asyncio.sleep(0.002)
        except Exception as e:
            print(f"[Beacon Warning] Failed to send multicast packet: {e}")

        await asyncio.sleep(interval)


async def main():
    parser = argparse.ArgumentParser(description="GridSight High-Concurrency Mock Agent Cluster")
    parser.add_argument("--count", type=int, default=70, help="Number of simulated agents (default: 70)")
    parser.add_argument("--base-port", type=int, default=8081, help="Starting HTTP port for agents (default: 8081)")
    parser.add_argument("--local-ip", type=str, default="", help="Custom local IP to advertise (auto-detect if empty)")
    parser.add_argument("--multicast-ip", type=str, default="239.255.0.1", help="Multicast IP group (default: 239.255.0.1)")
    parser.add_argument("--multicast-port", type=int, default=9000, help="Multicast UDP port (default: 9000)")
    parser.add_argument("--interval", type=float, default=1.0, help="Beacon broadcast interval in seconds (default: 1.0)")
    args = parser.parse_args()

    local_ip = args.local_ip if args.local_ip else get_default_local_ip()

    print("=" * 65)
    print(f"🚀 GridSight Mock Agent Cluster Initializing")
    print(f"   • Total Agents: {args.count} instances (MOCK-01 ~ MOCK-{args.count:02d})")
    print(f"   • Local Host IP: {local_ip}")
    print(f"   • Port Range: {args.base_port} ~ {args.base_port + args.count - 1}")
    print(f"   • Multicast Target: {args.multicast_ip}:{args.multicast_port}")
    print(f"   • Pillow Rendering: {'Enabled (Realistic Thumbnails)' if HAS_PIL else 'Disabled (Minimal JPEG)'}")
    print("=" * 65)

    agents = [MockAgent(i + 1, local_ip, args.base_port) for i in range(args.count)]

    # Start Async HTTP Servers for each port
    servers = []
    print(f"[HTTP] Spawning {args.count} async HTTP snapshot listeners...")
    for agent in agents:
        srv = await asyncio.start_server(agent.handle_client, '0.0.0.0', agent.port)
        servers.append(srv)

    print(f"[HTTP] All {args.count} ports listening successfully!")

    # Start Beacon Broadcaster Task
    beacon_task = asyncio.create_task(
        beacon_broadcast_loop(agents, args.multicast_ip, args.multicast_port, args.interval)
    )

    print(f"\n[Ready] Press Ctrl+C at any time to terminate the mock cluster.\n")

    try:
        await beacon_task
    except asyncio.CancelledError:
        pass
    finally:
        print("\nShutting down mock agent cluster...")
        for s in servers:
            s.close()
            await s.wait_closed()
        print("Mock agents stopped cleanly.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nProgram interrupted by user. Exiting.")
        sys.exit(0)
