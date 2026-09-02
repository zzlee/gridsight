#!/usr/bin/env python3
"""
GridSight Ubuntu Agent & Real-time Broadcast Debugger
=====================================================
Features:
- UDP 8888 Beacon discovery & dynamic teacher server pairing
- HTTP 1 FPS Snapshot pusher with mock/real telemetry & active window
- Reverse WebSocket client receiving teacher commands:
  * OPEN_URL
  * SHARE_FILE
  * SHUTDOWN / CANCEL_SHUTDOWN
  * START_STREAM / STOP_STREAM
- Real-time zero-latency FFplay RTP broadcast receiver & window display
- Real-time colorized debug log viewer
"""

import os
import sys
import time
import json
import socket
import struct
import shutil
import urllib.request
import threading
import subprocess
from datetime import datetime

# ANSI Colors for Terminal
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

MCAST_BEACON_IP = "239.255.42.99"
MCAST_BEACON_PORT = 8888
MCAST_RTP_IP = "239.255.42.100"
MCAST_RTP_PORT = 9000
MCAST_INPUT_RTP_IP = "239.255.42.100"
MCAST_INPUT_RTP_PORT = 9002

LOG_FILE = "data/ubuntu_agent_debug.log"
os.makedirs("data", exist_ok=True)

def log_event(category: str, msg: str, color: str = CYAN):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    line = f"{DIM}[{ts}]{RESET} {color}[{category:^12}]{RESET} {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] [{category:^12}] {msg}\n")
    except:
        pass

def get_primary_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip

class UbuntuAgentDebugger:
    def __init__(self, teacher_ip=None, port=3000):
        self.local_ip = get_primary_ip()
        self.mac = "FC:45:96:66:54:E7"
        self.hostname = socket.gethostname() or "ubuntu-debug-node"
        self.username = os.environ.get("USER", "tester")
        self.teacher_ip = teacher_ip
        self.port = port
        self.running = True
        self.ffplay_proc = None
        self.rtp_active = False
        self.rtp_packet_count = 0
        self.token = ""

    def start(self):
        self.print_banner()
        
        # 1. Discover teacher server if not provided
        if not self.teacher_ip:
            self.discover_teacher()

        # 2. Launch Beacon Heartbeat Thread
        threading.Thread(target=self.beacon_loop, daemon=True).start()

        # 3. Launch HTTP Snapshot Pusher Thread
        threading.Thread(target=self.snapshot_loop, daemon=True).start()

        # 4. Launch RTP Multicast Listener & Live Video Player Thread
        threading.Thread(target=self.rtp_player_loop, daemon=True).start()

        # 5. Launch Input RTP Multicast Listener (Mouse/Keyboard Events) Thread
        threading.Thread(target=self.input_rtp_loop, daemon=True).start()

        # 6. Launch WebSocket Reverse Command Loop (blocking or threaded)
        self.ws_command_loop()

    def print_banner(self):
        print(f"{BOLD}{GREEN}==============================================================={RESET}")
        print(f"{BOLD}{GREEN}   🖥️  GridSight Ubuntu Agent & Real-time Live Debugger       {RESET}")
        print(f"{BOLD}{GREEN}==============================================================={RESET}")
        print(f"{DIM} Local IP   :{RESET} {BOLD}{self.local_ip}{RESET}")
        print(f"{DIM} Hostname   :{RESET} {self.hostname} ({self.username})")
        print(f"{DIM} MAC Address:{RESET} {self.mac}")
        print(f"{DIM} Log File   :{RESET} {LOG_FILE}")
        print(f"{BOLD}{GREEN}---------------------------------------------------------------{RESET}\n")

    def discover_teacher(self):
        log_event("DISCOVERY", "Scanning for GridSight Console on local network...", YELLOW)
        parts = self.local_ip.split(".")
        subnet = f"{parts[0]}.{parts[1]}.{parts[2]}"
        
        for host in [72, 79, 185, 201, 100, 1]:
            target = f"{subnet}.{host}"
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(0.08)
                if s.connect_ex((target, self.port)) == 0:
                    self.teacher_ip = target
                    s.close()
                    break
                s.close()
            except:
                pass
        
        if self.teacher_ip:
            log_event("DISCOVERY", f"✅ Paired with Teacher Console at {BOLD}{self.teacher_ip}:{self.port}{RESET}", GREEN)
        else:
            self.teacher_ip = "192.168.190.72"
            log_event("DISCOVERY", f"⚠️ Defaulting teacher IP to {self.teacher_ip}:{self.port}", YELLOW)

    def beacon_loop(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(2.0)
        
        while self.running:
            try:
                payload = json.dumps({
                    "type": "BEACON",
                    "version": "5.8.4",
                    "hostname": self.hostname,
                    "ip": self.local_ip,
                    "mac": self.mac,
                    "username": self.username,
                    "active_window": "GridSight Debugger Console",
                    "timestamp": int(time.time() * 1000),
                    "specs": {
                        "agent_version": "5.8.4",
                        "os": "Ubuntu Linux (x64)",
                        "uptime": 3600,
                        "cpu": {"model": "Intel Core", "cores": 8, "usage_percent": 12.5},
                        "ram": {"total_mb": 16384, "avail_mb": 10120, "usage_percent": 38.2},
                        "disk": {"drive": "/", "total_gb": 256, "free_gb": 128, "usage_percent": 50.0}
                    }
                }).encode("utf-8")
                
                sock.sendto(payload, (MCAST_BEACON_IP, MCAST_BEACON_PORT))
                if self.teacher_ip:
                    sock.sendto(payload, (self.teacher_ip, MCAST_BEACON_PORT))

                # Listen for TOKEN_GRANT response
                try:
                    resp_data, resp_addr = sock.recvfrom(2048)
                    resp_json = json.loads(resp_data.decode("utf-8", errors="ignore"))
                    if resp_json.get("type") == "TOKEN_GRANT":
                        new_token = resp_json.get("token", "")
                        if new_token and new_token != self.token:
                            self.token = new_token
                            log_event("TOKEN", f"🔑 Received dynamic Token Grant from {resp_addr[0]}: {self.token[:12]}...", BOLD + GREEN)
                except socket.timeout:
                    pass
            except Exception as e:
                log_event("BEACON_ERR", str(e), RED)
            time.sleep(3.0)

    def snapshot_loop(self):
        dummy_jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\x27 \",#\x1c\x1c(7),01444\x1f\x27=82<.342\xff\xc0\x00\x0b\x08\x00\x10\x00\x10\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9"
        
        while self.running:
            if self.teacher_ip and self.token:
                try:
                    url = f"http://{self.teacher_ip}:{self.port}/api/agent/snapshot"
                    headers = {
                        "Content-Type": "image/jpeg",
                        "X-Agent-Mac": self.mac,
                        "X-Agent-Ip": self.local_ip,
                        "X-Agent-Hostname": self.hostname,
                        "X-Agent-Username": self.username,
                        "X-Auth-Token": self.token,
                        "X-Active-Window": "R3JpZFNpZ2h0IERlYnVnZ2Vy"
                    }
                    req = urllib.request.Request(url, data=dummy_jpeg, headers=headers)
                    urllib.request.urlopen(req, timeout=2.0)
                except Exception as e:
                    pass
            time.sleep(1.0)

    def rtp_player_loop(self):
        """Monitors RTP multicast stream and triggers FFplay player window"""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("", MCAST_RTP_PORT))
        
        try:
            mreq = struct.pack("4s4s", socket.inet_aton(MCAST_RTP_IP), socket.inet_aton(self.local_ip))
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        except:
            mreq = struct.pack("4sl", socket.inet_aton(MCAST_RTP_IP), socket.INADDR_ANY)
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

        sock.settimeout(2.0)
        sdp_path = "/tmp/gridsight_player.sdp"
        
        with open(sdp_path, "w") as f:
            f.write(f"v=0\no=- 0 0 IN IP4 {self.local_ip}\ns=GridSight Live Broadcast\nc=IN IP4 {MCAST_RTP_IP}\nt=0 0\nm=video {MCAST_RTP_PORT} RTP/AVP 96\na=rtpmap:96 H264/90000\n")

        log_event("RTP_RECEIVER", f"Listening on multicast {MCAST_RTP_IP}:{MCAST_RTP_PORT}...", GREEN)
        
        last_packet_time = 0

        while self.running:
            try:
                data, addr = sock.recvfrom(2048)
                self.rtp_packet_count += 1
                last_packet_time = time.time()

                if not self.rtp_active:
                    self.rtp_active = True
                    log_event("BROADCAST", f"🎬 Broadcast stream DETECTED from {addr[0]}:{addr[1]}! Launching real-time Player...", BOLD + GREEN)
                    self.launch_ffplay(sdp_path)

            except socket.timeout:
                if self.rtp_active and time.time() - last_packet_time > 4.0:
                    self.rtp_active = False
                    log_event("BROADCAST", "⏹️ Broadcast stream ended by teacher. Closing Player window.", YELLOW)
                    self.close_ffplay()

    def launch_ffplay(self, sdp_path):
        self.close_ffplay()
        cmd = [
            "ffplay",
            "-protocol_whitelist", "file,udp,rtp",
            "-fflags", "nobuffer",
            "-flags", "low_delay",
            "-framedrop",
            "-strict", "experimental",
            "-window_title", "GridSight 學生端即時廣播播放器 (即時解碼)",
            "-x", "1280", "-y", "720",
            "-i", sdp_path
        ]
        try:
            self.ffplay_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            log_event("PLAYER_ERR", f"Failed to launch ffplay: {e}", RED)

    def close_ffplay(self):
        if self.ffplay_proc:
            try:
                self.ffplay_proc.terminate()
                self.ffplay_proc.wait(timeout=1.0)
            except:
                try:
                    self.ffplay_proc.kill()
                except:
                    pass
            self.ffplay_proc = None

    def input_rtp_loop(self):
        """Monitors Input RTP multicast stream (mouse/keyboard events) and logs them in real time"""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("", MCAST_INPUT_RTP_PORT))
        except Exception as e:
            log_event("INPUT_ERR", f"Failed to bind UDP port {MCAST_INPUT_RTP_PORT}: {e}", RED)
            return

        try:
            mreq = struct.pack("4s4s", socket.inet_aton(MCAST_INPUT_RTP_IP), socket.inet_aton(self.local_ip))
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        except:
            mreq = struct.pack("4sl", socket.inet_aton(MCAST_INPUT_RTP_IP), socket.INADDR_ANY)
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

        sock.settimeout(2.0)
        log_event("INPUT_RTP", f"Listening on multicast {MCAST_INPUT_RTP_IP}:{MCAST_INPUT_RTP_PORT}...", GREEN)

        event_names = {
            1: "MouseMove",
            2: "MouseDown",
            3: "MouseUp",
            4: "Scroll",
            5: "KeyState",
            6: "Heartbeat"
        }

        pkt_count = 0
        last_seq = None

        while self.running:
            try:
                data, addr = sock.recvfrom(2048)
                if len(data) < 33:
                    continue

                v_p_x_cc, m_pt, seq, rtp_ts, ssrc = struct.unpack(">BBHII", data[:12])
                v = (v_p_x_cc >> 6) & 0x03
                if v != 2:
                    continue

                if last_seq is not None and seq == last_seq:
                    continue
                last_seq = seq

                ev_type, nx, ny, btn, scroll, mod, key, ts_ms = struct.unpack(">BHHBhBIQ", data[12:33])
                pkt_count += 1

                ev_name = event_names.get(ev_type, f"Type({ev_type})")
                pct_x = nx / 65535.0 * 100.0
                pct_y = ny / 65535.0 * 100.0

                btn_parts = []
                if btn & 0x01: btn_parts.append("LEFT")
                if btn & 0x02: btn_parts.append("RIGHT")
                if btn & 0x04: btn_parts.append("MIDDLE")
                btn_desc = "+".join(btn_parts) if btn_parts else "None"

                mod_parts = []
                if mod & 0x01: mod_parts.append("Ctrl")
                if mod & 0x02: mod_parts.append("Shift")
                if mod & 0x04: mod_parts.append("Alt")
                if mod & 0x08: mod_parts.append("Meta")
                mod_desc = f" [{'+'.join(mod_parts)}]" if mod_parts else ""

                if ev_type == 2:  # MouseDown
                    log_event("INPUT_CLICK", f"🔴 {BOLD}{btn_desc} CLICK DOWN{RESET} at ({pct_x:5.1f}%, {pct_y:5.1f}%){mod_desc} [seq={seq}]", BOLD + RED)
                elif ev_type == 3:  # MouseUp
                    log_event("INPUT_CLICK", f"⚪ {btn_desc} CLICK UP at ({pct_x:5.1f}%, {pct_y:5.1f}%){mod_desc} [seq={seq}]", YELLOW)
                elif ev_type == 4:  # Scroll
                    direction = "▲ UP" if scroll > 0 else "▼ DOWN"
                    log_event("INPUT_SCROLL", f"📜 Scroll {direction} ({scroll:+d}) at ({pct_x:5.1f}%, {pct_y:5.1f}%){mod_desc} [seq={seq}]", MAGENTA)
                elif ev_type == 5:  # KeyState
                    log_event("INPUT_KEY", f"⌨️ KeyCode={key}{mod_desc} [seq={seq}]", CYAN)
                else:  # MouseMove / Heartbeat
                    if pkt_count <= 5 or pkt_count % 30 == 0:
                        log_event("INPUT_MOVE", f"🖱️ Pos=({pct_x:5.1f}%, {pct_y:5.1f}%) btn={btn_desc}{mod_desc} [seq={seq}]", DIM + CYAN)

            except socket.timeout:
                continue
            except Exception as e:
                pass

    def ws_command_loop(self):
        """Connects reverse WebSocket to teacher console and logs all received events"""
        log_event("WS_CLIENT", f"Preparing reverse WebSocket to ws://{self.teacher_ip}:{self.port}/ws/agent...", CYAN)
        
        while self.running:
            if not self.token:
                time.sleep(1.0)
                continue

            try:
                # Basic WebSocket Client handshake
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(4.0)
                s.connect((self.teacher_ip, self.port))
                
                ws_key = "dGhlIHNhbXBsZSBub25jZQ=="
                req = (
                    f"GET /ws/agent?mac={self.mac}&ip={self.local_ip}&token={self.token} HTTP/1.1\r\n"
                    f"Host: {self.teacher_ip}:{self.port}\r\n"
                    "Upgrade: websocket\r\n"
                    "Connection: Upgrade\r\n"
                    f"Sec-WebSocket-Key: {ws_key}\r\n"
                    "Sec-WebSocket-Version: 13\r\n\r\n"
                )
                s.sendall(req.encode("utf-8"))
                
                resp = s.recv(2048).decode("utf-8", errors="ignore")
                if "101 Switching Protocols" in resp:
                    log_event("WS_CLIENT", "✅ Reverse WebSocket AUTHENTICATED & CONNECTED to Teacher!", BOLD + GREEN)
                    
                    s.settimeout(None)
                    while self.running:
                        header = s.recv(2)
                        if not header or len(header) < 2:
                            break
                        
                        b1, b2 = header[0], header[1]
                        opcode = b1 & 0x0F
                        is_masked = (b2 & 0x80) != 0
                        payload_len = b2 & 0x7F
                        
                        if payload_len == 126:
                            payload_len = struct.unpack("!H", s.recv(2))[0]
                        elif payload_len == 127:
                            payload_len = struct.unpack("!Q", s.recv(8))[0]
                            
                        mask_key = s.recv(4) if is_masked else None
                        payload = s.recv(payload_len)
                        
                        if is_masked and mask_key:
                            payload = bytes([b ^ mask_key[i % 4] for i, b in enumerate(payload)])
                            
                        if opcode == 0x1: # Text message
                            text = payload.decode("utf-8", errors="ignore")
                            self.handle_teacher_command(text)
                        elif opcode == 0x8: # Close
                            break
                        elif opcode == 0x9: # Ping -> Pong
                            s.sendall(bytes([0x8A, 0x00]))
                else:
                    log_event("WS_CLIENT", f"Handshake failed: {resp.splitlines()[0]}", RED)
                    s.close()
                    time.sleep(3.0)
            except Exception as e:
                log_event("WS_ERR", f"WebSocket disconnected ({e}), reconnecting in 2s...", YELLOW)
                time.sleep(2.0)

    def handle_teacher_command(self, raw_json: str):
        try:
            data = json.loads(raw_json)
            action = data.get("action", "UNKNOWN")
            
            if action == "OPEN_URL":
                url = data.get("url", "")
                log_event("EVENT_URL", f"🌐 Teacher dispatched URL to open: {BOLD}{url}{RESET}", BOLD + CYAN)
            elif action == "SHARE_FILE":
                url = data.get("url", "")
                fn = data.get("filename", "unknown_file")
                log_event("EVENT_FILE", f"📁 Teacher shared file: {BOLD}{fn}{RESET} (URL: {url})", BOLD + GREEN)
            elif action == "SHUTDOWN":
                timeout = data.get("timeout", 30)
                log_event("EVENT_POWER", f"⚡ Teacher ordered SHUTDOWN countdown: {BOLD}{timeout}s{RESET}", BOLD + RED)
            elif action == "CANCEL_SHUTDOWN":
                log_event("EVENT_POWER", f"🛑 Teacher ordered CANCEL_SHUTDOWN! Aborting countdown.", BOLD + GREEN)
            elif action == "START_STREAM":
                log_event("EVENT_STREAM", "🎥 Teacher opened 30 FPS Focus Monitor", MAGENTA)
            elif action == "STOP_STREAM":
                log_event("EVENT_STREAM", "⏹️ Teacher closed Focus Monitor", MAGENTA)
            elif action == "STOP_BROADCAST":
                log_event("EVENT_BCAST", "🛑 Teacher clicked STOP_BROADCAST", YELLOW)
                self.close_ffplay()
            else:
                log_event("EVENT_OTHER", f"📩 Received: {raw_json}", DIM)
        except Exception as e:
            log_event("EVENT_ERR", f"Parse error: {e} ({raw_json})", RED)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("--listen-input", "--input-only"):
        print(f"{BOLD}{GREEN}==============================================================={RESET}")
        print(f"{BOLD}{GREEN}   🖱️  GridSight Ubuntu Input RTP Live Monitor / Tester       {RESET}")
        print(f"{BOLD}{GREEN}==============================================================={RESET}")
        print(f"{DIM} Listening on Multicast:{RESET} {MCAST_INPUT_RTP_IP}:{MCAST_INPUT_RTP_PORT}")
        print(f"{DIM} Press Ctrl+C to stop...{RESET}\n")
        dbg = UbuntuAgentDebugger()
        try:
            dbg.input_rtp_loop()
        except KeyboardInterrupt:
            print("\nStopped.")
        sys.exit(0)

    t_ip = sys.argv[1] if len(sys.argv) > 1 else None
    agent = UbuntuAgentDebugger(teacher_ip=t_ip)
    try:
        agent.start()
    except KeyboardInterrupt:
        print("\nStopping debugger agent...")
        agent.running = False
        agent.close_ffplay()
