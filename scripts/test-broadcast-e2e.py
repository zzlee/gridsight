#!/usr/bin/env python3
"""
Broadcast (RTP Multicast) End-to-End Test Suite for GridSight.
Verifies the teacher broadcast feature locally by acting as a student:
joins the multicast group, receives RTP packets, validates headers
(RTP version, payload type, SSRC stability, sequence continuity) and
inspects H.264 NALU types (IDR/SPS/PPS/FU-A) inside the payloads.

Requires a running GridSight console on PORT (default 3000).
"""

import sys
import os
import json
import time
import socket
import struct
import urllib.request
import urllib.error

PORT = int(os.environ.get("GS_PORT", "3000"))
BASE = f"http://127.0.0.1:{PORT}"
PIN = os.environ.get("TEACHER_PIN", "888888")
GROUP = os.environ.get("BROADCAST_GROUP", "239.255.42.100")
RTP_PORT = int(os.environ.get("BROADCAST_RTP_PORT", "9000"))
LISTEN_SECONDS = float(os.environ.get("LISTEN_SECONDS", "8"))

PASS_COUNT = 0


def ok(name, detail=""):
    global PASS_COUNT
    PASS_COUNT += 1
    print(f"✅ {name}" + (f" — {detail}" if detail else ""))


def http_json(method, path, data=None, token=None):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        headers={"Authorization": f"Bearer {token}"} if token else {},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            pass
        return e.code, {"_raw": body}


def local_route_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "0.0.0.0"
    finally:
        s.close()


def rtp_receiver():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    except OSError:
        pass
    sock.bind(("", RTP_PORT))
    iface = socket.inet_aton(local_route_ip())
    mreq = socket.inet_aton(GROUP) + iface
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    sock.settimeout(1.0)
    return sock


class RtpStats:
    def __init__(self):
        self.count = 0
        self.bytes = 0
        self.ssrcs = set()
        self.seq_first = None
        self.seq_last = None
        self.seq_gaps = 0
        self.versions_bad = 0
        self.payload_types = {}
        self.nalu_types = set()

    def feed(self, pkt):
        if len(pkt) < 12:
            return
        b0, b1 = pkt[0], pkt[1]
        version = b0 >> 6
        if version != 2:
            self.versions_bad += 1
            return
        pt = b1 & 0x7F
        seq = struct.unpack(">H", pkt[2:4])[0]
        ssrc = struct.unpack(">I", pkt[8:12])[0]
        cc = b0 & 0x0F
        x = (b0 >> 4) & 0x1
        offset = 12 + 4 * cc
        if x:
            if len(pkt) < offset + 4:
                return
            ext_len = struct.unpack(">H", pkt[offset + 2:offset + 4])[0]
            offset += 4 + 4 * ext_len
        self.count += 1
        self.bytes += len(pkt)
        self.ssrcs.add(ssrc)
        self.payload_types[pt] = self.payload_types.get(pt, 0) + 1
        if self.seq_first is None:
            self.seq_first = seq
        elif self.seq_last is not None and ((seq - self.seq_last) & 0xFFFF) > 1:
            self.seq_gaps += 1
        self.seq_last = seq

        payload = pkt[offset:]
        if payload:
            nal_type = payload[0] & 0x1F
            if nal_type in (1, 5, 6, 7, 8):          # single NALU
                self.nalu_types.add(nal_type)
            elif nal_type == 28 and len(payload) > 1:  # FU-A: real type in byte 2
                self.nalu_types.add(payload[1] & 0x1F)


def main():
    print("Starting GridSight Broadcast E2E Tests...")
    print(f"Target: {BASE}  group={GROUP}:{RTP_PORT}\n")
    sock = None
    try:
        status, data = http_json("GET", "/api/auth/login")  # sanity: wrong method -> 404/401 acceptable
        token = None
        req = urllib.request.Request(f"{BASE}/api/auth/login",
                                     data=json.dumps({"pin": PIN}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            token = json.loads(resp.read().decode())["token"]
        ok("T1 教師登入")

        status, data = http_json("GET", "/api/broadcast/status", token=token)
        assert status == 200 and data.get("active") is False, f"pre-state not inactive: {data}"
        ok("T2 初始狀態 active=false")

        status, data = http_json("POST", "/api/broadcast/start",
                                 data=json.dumps({"fps": 30, "bitrateKbps": 5000}).encode(),
                                 token=token)
        assert status == 200 and data.get("active") is True, f"start failed: {status} {data}"
        ok("T3 廣播啟動（含 FFmpeg 存活探測）")

        sock = rtp_receiver()
        time.sleep(2.0)  # let encoder warm up / IDR arrive

        stats = RtpStats()
        deadline = time.time() + LISTEN_SECONDS
        while time.time() < deadline:
            try:
                pkt, _ = sock.recvfrom(2048)
                stats.feed(pkt)
            except socket.timeout:
                continue

        assert stats.count >= 50, f"too few RTP packets received: {stats.count}"
        ok("T4 收到 RTP 封包", f"{stats.count} packets / {LISTEN_SECONDS:.0f}s "
                              f"({stats.bytes * 8 / LISTEN_SECONDS / 1000:.0f} kbps)")

        assert stats.versions_bad == 0, "non-v2 RTP packets present"
        ok("T5 RTP 版本欄位全部為 2")

        assert len(stats.ssrcs) == 1, f"expected single SSRC stream, got {len(stats.ssrcs)}"
        ok("T6 單一 SSRC 串流", f"ssrc=0x{list(stats.ssrcs)[0]:08X}")

        assert stats.seq_gaps <= max(2, stats.count // 100), \
            f"excessive sequence gaps: {stats.seq_gaps}/{stats.count}"
        ok("T7 Sequence Number 連續性正常", f"gaps={stats.seq_gaps}")

        dominant_pt = max(stats.payload_types, key=stats.payload_types.get)
        assert stats.payload_types[dominant_pt] / stats.count > 0.9 and dominant_pt >= 96, \
            f"unexpected payload type distribution: {stats.payload_types}"
        ok("T8 Payload Type 為動態 H.264", f"PT={dominant_pt}")

        assert stats.nalu_types & {5, 7}, \
            f"no IDR/SPS seen (keyframes missing?) — nalu types seen: {sorted(stats.nalu_types)}"
        ok("T9 H.264 NALU 解析出關鍵幀", f"types seen: {sorted(stats.nalu_types)} "
                                          "(5=IDR 7=SPS 8=PPS 28=FU-A)")

        status, data = http_json("POST", "/api/broadcast/stop", token=token)
        assert status == 200 and data.get("active") is False, f"stop failed: {status} {data}"
        t_stop = time.time()
        drain_deadline = t_stop + 4.0
        arrivals = []
        while time.time() < drain_deadline:
            try:
                sock.recvfrom(2048)
                arrivals.append(time.time() - t_stop)
            except socket.timeout:
                if arrivals and time.time() - t_stop > arrivals[-1] + 1.5:
                    break
            except OSError:
                break
        # A short teardown tail (<1s) is expected OS behaviour; continuous flow means ghost encoder.
        assert not arrivals or arrivals[-1] <= 1.0, \
            f"packets still flowing {arrivals[-1]:.1f}s after stop — ghost encoder!"
        assert len(arrivals) < 100, \
            f"{len(arrivals)} packets arrived after stop — looks like an active stream, not teardown"
        ok("T10 停止後多播流量於 1 秒內歸零（無幽靈編碼器）",
           f"tail={len(arrivals)} pkts, last at {arrivals[-1] if arrivals else 0:.2f}s")

        print(f"\n🎉 ALL {PASS_COUNT} BROADCAST E2E TESTS PASSED!")
        return 0
    except Exception as e:
        print(f"\n❌ BROADCAST TEST FAILED at step {PASS_COUNT + 1}: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1
    finally:
        if sock:
            try:
                iface = socket.inet_aton(local_route_ip())
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_DROP_MEMBERSHIP,
                                socket.inet_aton(GROUP) + iface)
            except OSError:
                pass
            sock.close()
        try:
            req = urllib.request.Request(
                f"{BASE}/api/auth/login", data=json.dumps({"pin": PIN}).encode(),
                headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                token = json.loads(resp.read().decode())["token"]
            http_json("POST", "/api/broadcast/stop", token=token)
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
