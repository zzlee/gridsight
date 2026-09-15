#!/usr/bin/env python3
"""
GridSight High-Concurrency Mock Agent Cluster
Simulates 70~100+ student agents on a single Windows/Linux machine with minimal CPU & RAM usage.
Used for benchmarking teacher console rendering, network multicast, and snapshot throughput.
"""

import argparse
import asyncio
import base64
import json
import os
import random
import socket
import struct
import sys
import time
import urllib.parse
from pathlib import Path
from typing import List, Optional, Tuple

# Read version from root package.json (single source of truth)
def _read_version() -> str:
    for candidate in [
        Path(__file__).resolve().parent.parent / 'package.json',
        Path.cwd() / 'package.json',
    ]:
        try:
            return json.loads(candidate.read_text()).get('version', '5.9.0')
        except Exception:
            pass
    return '5.9.0'

APP_VERSION = _read_version()

# Try importing PIL for realistic synthetic thumbnail generation; fallback to raw JPEG if not available
try:
    from PIL import Image, ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

def create_sample_jpeg(agent_id: int, hostname: str, width: int = 480, height: int = 270) -> bytes:
    """Generates an in-memory realistic test screen JPEG with student label and timestamp."""
    import io
    if HAS_PIL:
        # Create dark background with window layout
        img = Image.new('RGB', (width, height), color=(15, 23, 42)) # slate-900
        draw = ImageDraw.Draw(img)

        # Draw header bar
        draw.rectangle([(0, 0), (width, 32)], fill=(30, 41, 59)) # slate-800
        draw.rectangle([(12, 10), (24, 22)], fill=(56, 189, 248)) # sky-400

        # Draw mock application windows
        colors = [(30, 58, 138), (88, 28, 135), (20, 83, 45), (120, 53, 15)]
        accent = colors[agent_id % len(colors)]
        draw.rounded_rectangle([(25, 45), (width - 25, height - 25)], radius=8, fill=(15, 23, 42), outline=accent, width=2)
        draw.rectangle([(25, 45), (width - 25, 72)], fill=accent)

        # Text information
        draw.text((36, 8), f"GridSight Mock Client - {hostname}", fill=(241, 245, 249))
        draw.text((38, 52), f"Seat / Workspace #{agent_id:02d}", fill=(255, 255, 255))
        draw.text((40, 85), f"Status: Live Streaming (Mock Source)", fill=(148, 163, 184))
        draw.text((40, 110), f"CPU: {random.randint(10, 40)}%  |  RAM: {random.randint(30, 65)}%", fill=(56, 189, 248))
        draw.text((40, 135), f"Resolution: {width}x{height} (16:9 Standard)", fill=(148, 163, 184))
        draw.text((40, height - 48), f"Time: {time.strftime('%H:%M:%S')}", fill=(100, 116, 139))

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

SAMPLE_WINDOWS = [
    "Visual Studio Code - main.py",
    "Google Chrome - Python Tutorial",
    "Dev-C++ - homework1.cpp",
    "Visual Studio - C# ConsoleApp",
    "Google Docs - 課堂隨堂筆記",
    "CodeBlocks - algorithm.c",
    "YouTube - 遊戲精華",
    "Bilibili - 新番動畫播放",
    "Roblox Player",
    "Discord - 班級聊天",
    "Sublime Text - index.html",
    "PowerShell - Windows",
]

class MockAgent:
    def __init__(self, agent_index: int, local_ip: str, base_port: int):
        self.index = agent_index
        self.port = base_port + agent_index - 1
        self.hostname = f"DESKTOP-MOCK-{self.index:02d}"
        self.username = f"Student{self.index:02d}"
        self.mac = f"00:50:56:C0:{self.index//256:02X}:{self.index%256:02X}"
        self.ip = local_ip
        self.active_window = SAMPLE_WINDOWS[(self.index - 1) % len(SAMPLE_WINDOWS)]
        self.metrics = {
            "cpu": random.randint(8, 35),
            "ram": random.randint(30, 60),
            "disk": random.randint(40, 70),
            "temp": random.randint(38, 55)
        }
        # Pre-cache JPEG in RAM for instant 0% CPU delivery
        self.jpeg_cache = create_sample_jpeg(self.index, self.hostname)
        self.is_online = True
        self.is_streaming = False
        self.offline_since = 0.0
        self.ws_writer: Optional[asyncio.StreamWriter] = None

    def set_online(self, online: bool):
        self.is_online = online
        if not online:
            self.offline_since = time.monotonic()
            if self.ws_writer:
                try:
                    self.ws_writer.close()
                except Exception:
                    pass
                self.ws_writer = None
        else:
            self.offline_since = 0.0

    def get_register_payload(self) -> dict:
        # Simulate slight dynamic fluctuation in telemetry metrics
        self.metrics["cpu"] = max(5, min(95, self.metrics["cpu"] + random.randint(-2, 2)))
        self.metrics["ram"] = max(20, min(90, self.metrics["ram"] + random.randint(-1, 1)))

        return {
            "action": "AGENT_INFO_REGISTER",
            "version": APP_VERSION,
            "hostname": self.hostname,
            "username": self.username,
            "ip": self.ip,
            "mac": self.mac,
            "active_window": self.active_window,
            "timestamp": int(time.time() * 1000),
            "specs": {
                "agent_version": APP_VERSION,
                "os": "Windows 11 Pro (Mock)",
                "uptime": 3600,
                "cpu": {"model": "Intel Core i7-12700 (Mock)", "cores": 12, "usage_percent": self.metrics["cpu"]},
                "ram": {"total_mb": 16384, "avail_mb": 8192, "usage_percent": self.metrics["ram"]},
                "disk": {"drive": "C:", "total_gb": 512, "free_gb": 256, "usage_percent": self.metrics["disk"]}
            }
        }

    def get_log_content(self) -> str:
        now_str = time.strftime('%Y-%m-%d %H:%M:%S')
        return (
            f"[{now_str}] [INFO] ========================================================\n"
            f"[{now_str}] [INFO] GridSight Student Agent gs-agent v{APP_VERSION}\n"
            f"[{now_str}] [INFO] Device Identity: Host={self.hostname}, MAC={self.mac}, IP={self.ip}\n"
            f"[{now_str}] [INFO] OS: Windows 11 Pro 64-bit | CPU: {self.metrics['cpu']}% | RAM: {self.metrics['ram']}%\n"
            f"[{now_str}] [INFO] ScreenCapturer active. Desktop Resolution: 1920x1080 @ 30 FPS.\n"
            f"[{now_str}] [INFO] H.264 Hardware Encoder: Initialized (Bitrate: 2500 kbps, 0% CPU loss).\n"
            f"[{now_str}] [INFO] Active Foreground Window: {self.active_window}\n"
            f"[{now_str}] [INFO] Reverse WebSocket Channel: Outbound connected to Teacher Console.\n"
            f"[{now_str}] [INFO] Telemetry Diagnostic: 0 dropped frames, network jitter: 0.9ms.\n"
            f"[{now_str}] [INFO] Self-Check Status: All internal services operating normally.\n"
            f"[{now_str}] [INFO] ========================================================\n"
        )

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

            if path.startswith('/api/snapshot') or path.startswith('/snapshot'):
                # Return pre-cached JPEG snapshot
                resp_headers = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: image/jpeg\r\n"
                    "Cache-Control: no-store, no-cache, must-revalidate\r\n"
                    "Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(self.jpeg_cache)}\r\n"
                    "Connection: close\r\n"
                    "\r\n"
                ).encode('utf-8')
                writer.write(resp_headers + self.jpeg_cache)
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
                resp_headers = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: application/json\r\n"
                    "Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    "Connection: close\r\n"
                    "\r\n"
                ).encode('utf-8')
                writer.write(resp_headers + body)
                await writer.drain()

            elif path.startswith('/api/logs') or path.startswith('/logs'):
                log_content = self.get_log_content().encode('utf-8')
                resp_headers = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: text/plain; charset=utf-8\r\n"
                    "Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(log_content)}\r\n"
                    "Connection: close\r\n"
                    "\r\n"
                ).encode('utf-8')
                writer.write(resp_headers + log_content)
                await writer.drain()

            elif path.startswith('/api/auth'):
                body = json.dumps({
                    "status": "ok",
                    "authenticated": True,
                    "token": f"mock-token-{self.index}-{int(time.time())}"
                }).encode('utf-8')
                resp_headers = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: application/json\r\n"
                    "Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    "Connection: close\r\n"
                    "\r\n"
                ).encode('utf-8')
                writer.write(resp_headers + body)
                await writer.drain()

            else:
                body = b'{"status":"ok","mock":true}'
                resp_headers = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: application/json\r\n"
                    "Access-Control-Allow-Origin: *\r\n"
                    f"Content-Length: {len(body)}\r\n"
                    "Connection: close\r\n"
                    "\r\n"
                ).encode('utf-8')
                writer.write(resp_headers + body)
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


def _ws_mask_frame(payload: bytes, opcode: int = 1) -> bytes:
    """RFC 6455 client frame (text or binary, masked)."""
    mask = os.urandom(4)
    n = len(payload)
    b0 = 0x80 | (opcode & 0x0F)
    if n < 126:
        header = bytes([b0, 0x80 | n])
    elif n < 65536:
        header = bytes([b0, 0x80 | 126]) + n.to_bytes(2, 'big')
    else:
        header = bytes([b0, 0x80 | 127]) + n.to_bytes(8, 'big')
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return header + mask + masked


async def ws_agent_connection(teacher_ip: str, teacher_port: int, agent: MockAgent):
    """Connects the mock agent to the teacher console over a single outbound
    reverse WebSocket (/ws/agent) and sends AGENT_INFO_REGISTER + periodic
    re-registration. Mirrors the real gs-agent flow in the new architecture."""
    if not agent.is_online:
        await asyncio.sleep(2)
        return

    key = base64.b64encode(os.urandom(16)).decode()
    query = "?mac=" + urllib.parse.quote(agent.mac) + "&ip=" + urllib.parse.quote(agent.ip)
    try:
        reader, writer = await asyncio.open_connection(teacher_ip, teacher_port)
    except Exception:
        await asyncio.sleep(3)
        return

    agent.ws_writer = writer
    try:
        req = (
            f"GET /ws/agent{query} HTTP/1.1\r\n"
            f"Host: {teacher_ip}:{teacher_port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        writer.write(req.encode())
        await writer.drain()

        # Read handshake response headers
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = await reader.read(4096)
            if not chunk:
                writer.close()
                return
            resp += chunk
        if b"101" not in resp.split(b"\r\n", 1)[0]:
            writer.close()
            return

        print(f"[WS] {agent.hostname} ({agent.mac}) registered -> ws://{teacher_ip}:{teacher_port}/ws/agent")
        last_register = 0.0
        while agent.is_online:
            now = time.monotonic()
            if now - last_register >= 10:
                payload = json.dumps(agent.get_register_payload()).encode('utf-8')
                writer.write(_ws_mask_frame(payload))
                await writer.drain()
                last_register = now

            try:
                b0, b1 = await asyncio.wait_for(reader.readexactly(2), timeout=2.0)
            except asyncio.TimeoutError:
                continue
            except Exception:
                break
            opcode = b0 & 0x0f
            length = b1 & 0x7f
            if length == 126:
                length = int.from_bytes(await reader.readexactly(2), 'big')
            elif length == 127:
                length = int.from_bytes(await reader.readexactly(8), 'big')
            if opcode == 8:  # close
                break
            if opcode == 9:  # ping -> pong (echo payload)
                frame_payload = await reader.readexactly(length) if length else b""
                if length:
                    writer.write(bytes([0x8A, 0x80 | length]) + os.urandom(4) + frame_payload)
                else:
                    writer.write(b'\x8a\x80' + os.urandom(4))
                await writer.drain()
            elif opcode == 10:  # pong
                if length:
                    await reader.readexactly(length)
            elif opcode == 1:  # Text frame (command from console)
                frame_payload = await reader.readexactly(length) if length else b""
                try:
                    msg = json.loads(frame_payload.decode('utf-8'))
                    action = msg.get('action')
                    if action == 'START_ROLL_CALL':
                        rc_id = msg.get('rollCallId') or ''
                        async def delayed_rollcall(a=agent, rid=rc_id, w=writer):
                            await asyncio.sleep(random.uniform(0.4, 2.0))
                            resp_obj = {
                                "action": "ROLL_CALL_RESPONSE",
                                "rollCallId": rid,
                                "studentId": f"S{11000 + a.index:05d}"
                            }
                            resp_bytes = json.dumps(resp_obj).encode('utf-8')
                            try:
                                w.write(_ws_mask_frame(resp_bytes))
                                await w.drain()
                                print(f"[RollCall] 📝 {a.hostname} checked in as {resp_obj['studentId']}")
                            except Exception:
                                pass
                        asyncio.create_task(delayed_rollcall())
                    elif action == 'GET_LOGS':
                        resp_obj = {
                            "action": "LOGS_REPORT",
                            "logs": agent.get_log_content()
                        }
                        resp_bytes = json.dumps(resp_obj).encode('utf-8')
                        writer.write(_ws_mask_frame(resp_bytes))
                        await writer.drain()
                        print(f"[Log] 📜 {agent.hostname} ({agent.mac}) successfully returned diagnostic logs to teacher console")
                    elif action == 'START_STREAM':
                        agent.is_streaming = True
                        async def stream_worker(a=agent, w=writer):
                            print(f"[Stream] 🎥 {a.hostname} ({a.mac}) started live focus streaming")
                            while a.is_streaming and a.is_online and a.ws_writer == w:
                                try:
                                    w.write(_ws_mask_frame(a.jpeg_cache, opcode=2))
                                    await w.drain()
                                except Exception:
                                    break
                                await asyncio.sleep(0.033)  # ~30 FPS
                            print(f"[Stream] ⏹️ {a.hostname} ({a.mac}) stopped live focus streaming")
                        asyncio.create_task(stream_worker())
                    elif action == 'STOP_STREAM':
                        agent.is_streaming = False
                except Exception:
                    pass
            else:
                if length:
                    await reader.readexactly(length)  # ignore other bulk messages
    except Exception:
        pass
    finally:
        agent.ws_writer = None
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def _agent_ws_runner(teacher_ip: str, teacher_port: int, agent: MockAgent, interval: float = 1.0):
    while True:
        if agent.is_online:
            try:
                await ws_agent_connection(teacher_ip, teacher_port, agent)
            except Exception:
                pass
        await asyncio.sleep(interval)


async def ws_register_loop(agents: List[MockAgent], teacher_ip: str, teacher_port: int = 3000, interval: float = 1.0):
    """Connects every simulated agent to the teacher console via reverse WS
    and registers its identity."""
    print(f"[WS] Reverse WebSocket registration loop -> ws://{teacher_ip}:{teacher_port}/ws/agent ({len(agents)} agents)")
    workers = [asyncio.create_task(_agent_ws_runner(teacher_ip, teacher_port, agent, interval)) for agent in agents]
    await asyncio.gather(*workers)


async def push_single_snapshot(teacher_ip: str, teacher_port: int, agent: MockAgent):
    """Sends a single HTTP POST snapshot asynchronously via raw TCP socket."""
    if not agent.is_online:
        return
    try:
        reader, writer = await asyncio.open_connection(teacher_ip, teacher_port)
        req_headers = (
            f"POST /api/agent/snapshot HTTP/1.1\r\n"
            f"Host: {teacher_ip}:{teacher_port}\r\n"
            f"Content-Type: image/jpeg\r\n"
            f"x-agent-mac: {agent.mac}\r\n"
            f"x-agent-ip: {agent.ip}\r\n"
            f"x-agent-hostname: {agent.hostname}\r\n"
            f"Content-Length: {len(agent.jpeg_cache)}\r\n"
            f"Connection: close\r\n"
            f"\r\n"
        ).encode('utf-8')
        writer.write(req_headers + agent.jpeg_cache)
        await writer.drain()
        writer.close()
        await writer.wait_closed()
    except Exception:
        pass


async def snapshot_push_loop(agents: List[MockAgent], teacher_ip: str, teacher_port: int = 3000, interval: float = 1.0):
    """Asynchronously pushes snapshots for all agents concurrently to the teacher console."""
    print(f"[Snapshot Push] Async non-blocking push loop active -> http://{teacher_ip}:{teacher_port}/api/agent/snapshot")

    while True:
        try:
            # Concurrently push snapshots in parallel batches
            tasks = [push_single_snapshot(teacher_ip, teacher_port, agent) for agent in agents]
            await asyncio.gather(*tasks, return_exceptions=True)
        except Exception:
            pass

        await asyncio.sleep(interval)


def listen_discovery_sync(mcast_ip: str, mcast_port: int, local_ip: str, timeout: float = 3.0) -> Optional[Tuple[str, int]]:
    """Listens synchronously for a single DISCOVERY packet from the teacher console."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "SO_REUSEPORT"):
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except Exception:
            pass
    try:
        sock.bind(("", mcast_port))
    except Exception:
        return None

    try:
        mreq = struct.pack("4s4s", socket.inet_aton(mcast_ip), socket.inet_aton(local_ip))
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    except Exception:
        try:
            mreq = struct.pack("4sl", socket.inet_aton(mcast_ip), socket.INADDR_ANY)
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        except Exception:
            pass

    sock.settimeout(timeout)
    try:
        data, _ = sock.recvfrom(2048)
        pkt = json.loads(data.decode("utf-8", errors="ignore"))
        if pkt.get("type") == "DISCOVERY" and pkt.get("teacherIp"):
            return pkt["teacherIp"], int(pkt.get("teacherPort", 3000))
    except Exception:
        pass
    finally:
        sock.close()
    return None


async def churn_loop(agents: List[MockAgent], churn_count: int = 2, interval: float = 5.0, offline_duration: float = 10.0):
    """Periodically flips online status of random agents to test UI disconnection & recovery."""
    print(f"[Churn] 🎲 Flapping simulation active: picks {churn_count} agents every {interval}s to go offline (stays offline for >= {offline_duration}s)...")
    while True:
        await asyncio.sleep(interval)
        now = time.monotonic()

        # 1. 檢查離線時間已達到 offline_duration (預設 10s) 的 agents，予以恢復上線
        offline_list = [a for a in agents if not a.is_online]
        for a in offline_list:
            elapsed = now - a.offline_since
            if elapsed >= offline_duration:
                a.set_online(True)
                print(f"\033[92m[Churn] 🟢 {a.hostname} ({a.mac}) 離線滿 {elapsed:.1f}s，模擬重新連線 / 恢復上線！\033[0m")

        # 2. 隨機挑選 churn_count 台在線 agents 斷線
        online_list = [a for a in agents if a.is_online]
        if online_list:
            targets = random.sample(online_list, min(churn_count, len(online_list)))
            for a in targets:
                a.set_online(False)
                print(f"\033[91m[Churn] 🔻 {a.hostname} ({a.mac}) 模擬網路中斷 / 異常離線（將維持離線至少 {offline_duration}s）...\033[0m")


async def discovery_and_connect_loop(
    agents: List[MockAgent],
    mcast_ip: str,
    mcast_port: int,
    local_ip: str,
    interval: float = 1.0,
    churn: bool = False,
    churn_count: int = 2,
    churn_interval: float = 5.0,
    churn_offline_duration: float = 10.0,
):
    """Auto-discovers the Teacher Console via multicast,
    then launches reverse WebSocket registration and HTTP snapshot pushing."""
    print(f"[Discovery] ⏳ Listening for DISCOVERY multicast announcement on {mcast_ip}:{mcast_port}...")
    loop = asyncio.get_running_loop()
    active_ip = ""
    active_port = 3000

    while not active_ip:
        res = await loop.run_in_executor(None, listen_discovery_sync, mcast_ip, mcast_port, local_ip, 2.0)
        if res:
            active_ip, active_port = res
            print(f"[Discovery] 📡 Auto-discovered Teacher Console via multicast: http://{active_ip}:{active_port}")
            break
        await asyncio.sleep(0.5)

    ws_task = asyncio.create_task(ws_register_loop(agents, active_ip, active_port, interval))
    push_task = asyncio.create_task(snapshot_push_loop(agents, active_ip, active_port, interval))
    tasks = [ws_task, push_task]
    if churn:
        tasks.append(asyncio.create_task(churn_loop(agents, churn_count, churn_interval, churn_offline_duration)))
    await asyncio.gather(*tasks)


async def main():
    parser = argparse.ArgumentParser(description="GridSight High-Concurrency Mock Agent Cluster")
    parser.add_argument("--count", type=int, default=70, help="Number of simulated agents (default: 70)")
    parser.add_argument("--base-port", type=int, default=18081, help="Starting port (deprecated)")
    parser.add_argument("--local-ip", type=str, default="", help="Custom local IP to advertise (auto-detect if empty)")
    parser.add_argument("--multicast-ip", type=str, default="239.255.42.99", help="Multicast IP group (default: 239.255.42.99)")
    parser.add_argument("--multicast-port", type=int, default=8888, help="Multicast UDP port (default: 8888)")
    parser.add_argument("--interval", type=float, default=1.0, help="Reconnect/register interval in seconds (default: 1.0)")
    parser.add_argument("--churn", action="store_true", help="Enable random agent offline/online flapping simulation")
    parser.add_argument("--churn-count", type=int, default=2, help="Number of agents to flap at a time (default: 2)")
    parser.add_argument("--churn-interval", type=float, default=5.0, help="Interval between flapping events in seconds (default: 5.0)")
    parser.add_argument("--churn-offline-duration", type=float, default=10.0, help="Minimum seconds an agent stays offline before recovery (default: 10.0)")
    args = parser.parse_args()

    local_ip = args.local_ip if args.local_ip else get_default_local_ip()

    print("=" * 68)
    print(f"🚀 GridSight Mock Agent Cluster Initializing")
    print(f"   • Total Agents: {args.count} instances (MOCK-01 ~ MOCK-{args.count:02d})")
    print(f"   • Local Host IP: {local_ip}")
    print(f"   • Teacher Console: Auto-discovery active (via {args.multicast_ip}:{args.multicast_port})")
    print(f"   • Flapping Simulation (Churn): {'Enabled (' + str(args.churn_count) + ' agents every ' + str(args.churn_interval) + 's, offline for >= ' + str(args.churn_offline_duration) + 's)' if args.churn else 'Disabled'}")
    print(f"   • Pillow Rendering: {'Enabled (Realistic Thumbnails)' if HAS_PIL else 'Disabled (Minimal JPEG)'}")
    print("=" * 68)

    # Start Async HTTP Servers with automatic port collision avoidance
    servers = []
    agents = []
    current_port = args.base_port

    print(f"[HTTP] Spawning {args.count} async HTTP snapshot listeners starting at port {args.base_port}...")
    for i in range(args.count):
        while True:
            agent = MockAgent(i + 1, local_ip, current_port)
            try:
                srv = await asyncio.start_server(agent.handle_client, '0.0.0.0', current_port)
                servers.append(srv)
                agents.append(agent)
                current_port += 1
                break
            except OSError:
                # Port already in use by another process -> seamlessly try next port
                current_port += 1
                if current_port > 65000:
                    print("[Error] Ran out of available network ports.")
                    return

    print(f"[HTTP] All {args.count} agents listening successfully (Ports: {agents[0].port} ~ {agents[-1].port})!")

    # Start Auto-Discovery and Connection Tasks
    connect_task = asyncio.create_task(
        discovery_and_connect_loop(
            agents,
            args.multicast_ip,
            args.multicast_port,
            local_ip,
            args.interval,
            args.churn,
            args.churn_count,
            args.churn_interval,
            args.churn_offline_duration,
        )
    )

    print(f"\n[Ready] Press Ctrl+C at any time to terminate the mock cluster.\n")

    try:
        await connect_task
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
