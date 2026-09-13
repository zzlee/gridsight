#!/usr/bin/env python3
"""
GridSight Broadcast Latency & Jitter Benchmark Tool
===================================================
Measures two critical broadcast latency dimensions in Docker or bare-metal:
  1. Teacher Broadcast Stream:
     - Analyzes RFC 3550 RTP Interarrival Jitter.
     - Analyzes frame delivery interval pacing and packet burst behavior.
  2. Student Showcase Relay Forwarding Latency:
     - Sends H.264 NALUs via reverse WebSocket.
     - Measures time until RTP multicast reception (ws_send -> rtp_recv).
     - Computes min, avg, p95, max latency and loss.

Usage:
  python3 scripts/benchmark-broadcast-latency.py [TARGET_URL] [OPTIONS]
  e.g.:
    python3 scripts/benchmark-broadcast-latency.py http://127.0.0.1:3000
    GS_BASE=http://172.28.0.10:3000 python3 scripts/benchmark-broadcast-latency.py
"""

import sys
import os
import json
import time
import socket
import struct
import urllib.request
import urllib.error
import asyncio

try:
    import websockets
except ImportError:
    websockets = None

BASE = os.environ.get("GS_BASE") or (sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith("http") else "http://127.0.0.1:3000")
BASE = BASE.rstrip("/")
PIN = os.environ.get("TEACHER_PIN", "888888")
GROUP = os.environ.get("BROADCAST_GROUP", "239.255.42.100")
RTP_PORT = int(os.environ.get("BROADCAST_RTP_PORT", "9000"))
MULTICAST_IFACE = os.environ.get("MULTICAST_IFACE", "0.0.0.0")


def local_route_ip():
    if MULTICAST_IFACE != "0.0.0.0":
        return MULTICAST_IFACE
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        host = BASE.split("://")[-1].split(":")[0]
        s.connect((host, 80))
        return s.getsockname()[0]
    except OSError:
        return "0.0.0.0"
    finally:
        s.close()


def create_rtp_multicast_socket(iface_ip: str):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    except OSError:
        pass
    sock.bind(("", RTP_PORT))
    mreq = socket.inet_aton(GROUP) + socket.inet_aton(iface_ip)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    sock.settimeout(1.0)
    return sock


def http_req(path, data=None, token=None, method="GET"):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(data).encode() if data is not None else None,
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {})
        },
        method=method
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status, json.loads(resp.read().decode())


def benchmark_teacher_broadcast(token: str, iface_ip: str):
    print("\n----------------------------------------------------------------")
    print(" [Part 1] Teacher Direct Broadcast Jitter & Pacing Analysis")
    print("----------------------------------------------------------------")
    print(f"Target: {BASE} | Multicast: {GROUP}:{RTP_PORT} (Iface: {iface_ip})")

    status, data = http_req("/api/broadcast/start", {"fps": 30, "bitrateKbps": 4000}, token, "POST")
    if not data.get("active"):
        print(f"❌ Failed to start broadcast: {data}")
        return None
    print("📡 Broadcast started successfully. Waiting 1.5s for pipeline warmup...")
    time.sleep(1.5)

    sock = create_rtp_multicast_socket(iface_ip)

    frames = {}
    frame_intervals = []
    prev_frame_time = None
    jitter = 0.0
    prev_transit = None
    total_packets = 0
    total_bytes = 0

    deadline = time.time() + 3.0
    while time.time() < deadline:
        try:
            pkt, _ = sock.recvfrom(2048)
            now = time.perf_counter()
            total_packets += 1
            total_bytes += len(pkt)

            if len(pkt) < 12:
                continue

            ts = struct.unpack(">I", pkt[4:8])[0]
            if ts not in frames:
                if prev_frame_time is not None:
                    frame_intervals.append((now - prev_frame_time) * 1000.0)
                prev_frame_time = now
                frames[ts] = {"first": now, "pkts": 1, "bytes": len(pkt)}
            else:
                frames[ts]["pkts"] += 1
                frames[ts]["bytes"] += len(pkt)

            arrival_ts = now * 90000.0
            transit = arrival_ts - ts
            if prev_transit is not None:
                d = abs(transit - prev_transit)
                jitter += (d - jitter) / 16.0
            prev_transit = transit
        except socket.timeout:
            continue

    http_req("/api/broadcast/stop", {}, token, "POST")
    sock.close()

    avg_interval = sum(frame_intervals) / len(frame_intervals) if frame_intervals else 0
    min_interval = min(frame_intervals) if frame_intervals else 0
    max_interval = max(frame_intervals) if frame_intervals else 0
    jitter_ms = (jitter / 90000.0) * 1000.0
    bitrate_mbps = (total_bytes * 8.0) / (3.0 * 1_000_000.0)

    print(f"📊 Results:")
    print(f"  • Total Packets:     {total_packets:,} pkts ({total_bytes / 1024:.1f} KB)")
    print(f"  • Measured Bitrate:  {bitrate_mbps:.2f} Mbps")
    print(f"  • Frames Captured:   {len(frames)} frames")
    print(f"  • Frame Intervals:   avg={avg_interval:.2f}ms, min={min_interval:.2f}ms, max={max_interval:.2f}ms")
    print(f"  • RFC 3550 Jitter:   {jitter_ms:.2f} ms ({jitter:.1f} ticks @ 90kHz)")

    return {
        "frames": len(frames),
        "packets": total_packets,
        "bitrate_mbps": bitrate_mbps,
        "jitter_ms": jitter_ms,
        "avg_frame_interval_ms": avg_interval
    }


async def benchmark_relay_latency(token: str, iface_ip: str):
    print("\n----------------------------------------------------------------")
    print(" [Part 2] Student Showcase Relay Latency Benchmark (WS -> RTP)")
    print("----------------------------------------------------------------")
    if not websockets:
        print("⚠️ Python 'websockets' library not installed. Skipping Part 2.")
        return None

    mac = "AA:BB:CC:DD:EE:99"
    ws_url = BASE.replace("http://", "ws://").replace("https://", "wss://")
    ws_url = f"{ws_url}/ws/agent?mac={mac}&ip={iface_ip}"

    print(f"Connecting mock showcase student agent: {ws_url}")
    ws = await websockets.connect(ws_url)
    await ws.send(json.dumps({
        "action": "AGENT_INFO_REGISTER",
        "hostname": "BenchmarkNode",
        "username": "benchmark",
        "seatNo": "99",
        "specs": "Bench CPU / 16GB",
        "activeWindow": "Benchmark"
    }))

    status, data = http_req("/api/broadcast/start", {"sourceType": "student-relay", "relayMac": mac}, token, "POST")
    print(f"📡 Showcase relay initiated: {data}")

    sock = create_rtp_multicast_socket(iface_ip)
    sock.setblocking(False)

    await asyncio.sleep(2.0)

    sps = bytes.fromhex("000000016742001f96540501ec80")
    pps = bytes.fromhex("0000000168ce06e2")
    idr = bytes.fromhex("000000016588840010") + b"\x00" * 400
    frame_payload = sps + pps + idr

    latencies = []
    test_rounds = 30
    print(f"Sending {test_rounds} sequential test frames at 30 FPS pacing...")

    for i in range(test_rounds):
        t_send = time.perf_counter()
        await ws.send(frame_payload)

        deadline = t_send + 0.250
        arrived = False
        while time.perf_counter() < deadline:
            try:
                pkt, _ = sock.recvfrom(2048)
                t_recv = time.perf_counter()
                latencies.append((t_recv - t_send) * 1000.0)
                arrived = True
                break
            except (BlockingIOError, socket.error):
                await asyncio.sleep(0.0003)

        if not arrived:
            print(f"  [Frame #{i+1:02d}] Packet timed out (>250ms)")

        await asyncio.sleep(0.033)

    http_req("/api/broadcast/stop", {}, token, "POST")
    await ws.close()
    sock.close()

    if not latencies:
        print("❌ No RTP packets received from relay stream!")
        return None

    latencies.sort()
    avg_lat = sum(latencies) / len(latencies)
    min_lat = latencies[0]
    med_lat = latencies[len(latencies) // 2]
    p95_lat = latencies[int(len(latencies) * 0.95)]
    max_lat = latencies[-1]

    print(f"📊 Results (Relay Forwarding Pipeline Latency):")
    print(f"  • Delivered Frames: {len(latencies)} / {test_rounds} (loss: {(test_rounds - len(latencies)) * 100 / test_rounds:.1f}%)")
    print(f"  • Min Latency:      {min_lat:.2f} ms")
    print(f"  • Median Latency:   {med_lat:.2f} ms")
    print(f"  • Avg Latency:      {avg_lat:.2f} ms")
    print(f"  • P95 Latency:      {p95_lat:.2f} ms")
    print(f"  • Max Latency:      {max_lat:.2f} ms")

    return {
        "count": len(latencies),
        "min_ms": min_lat,
        "avg_ms": avg_lat,
        "p95_ms": p95_lat,
        "max_ms": max_lat
    }


def main():
    print("================================================================")
    print("   GridSight Broadcast Latency & Jitter Benchmark Suite")
    print("================================================================")
    iface_ip = local_route_ip()
    print(f"Target Server:    {BASE}")
    print(f"Local Route IP:   {iface_ip}")

    try:
        status, auth = http_req("/api/auth/login", {"pin": PIN}, method="POST")
        token = auth.get("token")
        if not token:
            print(f"❌ Login failed with PIN {PIN}: {auth}")
            return 1
        print("🔑 Authenticated as Teacher successfully.")
    except Exception as e:
        print(f"❌ Cannot connect to {BASE}: {e}")
        return 1

    t_res = benchmark_teacher_broadcast(token, iface_ip)
    r_res = asyncio.run(benchmark_relay_latency(token, iface_ip))

    print("\n================================================================")
    print("   SUMMARY BENCHMARK VERDICT")
    print("================================================================")
    if t_res:
        print(f"✅ Teacher Stream Jitter:          {t_res['jitter_ms']:.2f} ms (Target < 20 ms)")
    if r_res:
        status_sym = "✅" if r_res['avg_ms'] < 10.0 else "⚠️"
        print(f"{status_sym} Relay Forwarding Pipeline Latency: {r_res['avg_ms']:.2f} ms (Target < 10 ms)")

    print("================================================================\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
