#!/usr/bin/env python3
"""
Share URL & File Sharing Integration Test Suite for GridSight.
Covers: auth guards, validation, URL auto-prefix, raw upload roundtrip,
download integrity, path traversal resistance, and WebSocket delivery
to a mock student agent (OPEN_URL / SHARE_FILE).
Requires a running GridSight console on PORT (default 3000).
"""

import sys
import os
import json
import time
import base64
import hashlib
import struct
import socket
import urllib.request
import urllib.error
import urllib.parse

PORT = int(os.environ.get("GS_PORT", "3000"))
BASE = f"http://127.0.0.1:{PORT}"
PIN = os.environ.get("TEACHER_PIN", "888888")
MOCK_MAC = "AABBCCDDEEFF"

PASS_COUNT = 0


def ok(name, detail=""):
    global PASS_COUNT
    PASS_COUNT += 1
    print(f"✅ {name}" + (f" — {detail}" if detail else ""))


def http(method, path, data=None, headers=None, timeout=5):
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def json_of(body):
    try:
        return json.loads(body.decode("utf-8"))
    except Exception:
        return {}


# ---------------------------------------------------------------- auth

def get_token():
    status, _, body = http("POST", "/api/auth/login",
                           data=json.dumps({"pin": "000000"}).encode(),
                           headers={"Content-Type": "application/json"})
    assert status == 401, f"wrong PIN should be rejected, got {status}"

    status, _, body = http("POST", "/api/auth/login",
                           data=json.dumps({"pin": PIN}).encode(),
                           headers={"Content-Type": "application/json"})
    assert status == 200, f"login failed: {status}"
    token = json_of(body).get("token")
    assert token, "login returned no token"
    return token


def auth_headers(token, extra=None):
    h = {"Authorization": f"Bearer {token}"}
    if extra:
        h.update(extra)
    return h


# ---------------------------------------------------------------- mock agent (RFC6455 client, stdlib only)

class MockAgent:
    def __init__(self, mac=MOCK_MAC):
        self.mac = mac
        self.sock = socket.create_connection(("127.0.0.1", PORT), timeout=8)
        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            f"GET /ws/agent?mac={mac}&ip=127.0.0.1&token=mocktoken HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{PORT}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(handshake.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise AssertionError("WS handshake: connection closed")
            buf += chunk
        head = buf.split(b"\r\n\r\n")[0].decode("latin-1")
        assert "101" in head.split("\r\n")[0], f"WS upgrade refused: {head.splitlines()[0]}"
        expect = base64.b64encode(hashlib.sha1(
            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        assert expect in head, "WS Sec-WebSocket-Accept mismatch"

    def recv_text(self, want_timeout=4.0):
        self.sock.settimeout(want_timeout)
        hdr = self._recvn(2)
        opcode = hdr[0] & 0x0F
        length = hdr[1] & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._recvn(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._recvn(8))[0]
        payload = self._recvn(length) if length else b""
        if opcode == 0x9:  # ping -> pong
            self.sock.sendall(b"\x8a\x00")
            return self.recv_text(want_timeout)
        assert opcode in (0x1, 0x2, 0x0), f"unexpected WS opcode {opcode}"
        return payload.decode("utf-8", errors="replace")

    def _recvn(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise AssertionError("WS connection closed by server")
            buf += chunk
        return buf

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def wait_for_action(agent, action, timeout=6.0):
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            msg = agent.recv_text(want_timeout=max(0.3, deadline - time.time()))
        except (socket.timeout, TimeoutError):
            break
        last = msg
        try:
            parsed = json.loads(msg)
        except json.JSONDecodeError:
            continue
        if parsed.get("action") == action:
            return parsed
    raise AssertionError(f"mock agent did not receive action={action}; last frame: {last[:200]!r}")


# ---------------------------------------------------------------- tests

def test_url_share_auth_and_validation(token):
    status, _, _ = http("POST", "/api/share/url",
                        data=json.dumps({"url": "https://example.com"}).encode(),
                        headers={"Content-Type": "application/json"})
    assert status == 401, f"unauthenticated share/url must be 401, got {status}"
    ok("T1 /api/share/url 未帶 token -> 401")

    status, _, body = http("POST", "/api/share/url", data=b"",
                           headers=auth_headers(token))
    assert status == 400, f"empty url must be 400, got {status}"
    ok("T3 空網址 -> 400", json_of(body).get("error", ""))


def test_url_share_no_agents(token):
    status, _, body = http("POST", "/api/share/url",
                           data=json.dumps({"url": "example.com/test", "targets": []}).encode(),
                           headers={**auth_headers(token), "Content-Type": "application/json"})
    assert status == 200, f"share/url failed: {status} {body[:200]}"
    data = json_of(body)
    assert data.get("success") is True, f"success flag missing: {data}"
    assert data.get("count") == 0, f"expected count=0 with no agents, got {data.get('count')}"
    assert data.get("url") == "http://example.com/test", f"http:// prefix not applied: {data.get('url')}"
    ok("T5 無學生端時廣播網址 -> success + count=0 + 自補 http://")


def test_file_share_roundtrip(token):
    payload = bytes(range(256)) * 129 + b"GRIDSHIFT-EOF-MARKER"  # ~33 KB deterministic blob
    fname = "作業說明 v1.txt"

    status, _, body = http("POST", "/api/share/file", data=b"", headers=auth_headers(token))
    assert status == 400, f"empty file body must be 400, got {status}"
    ok("T7 空檔案內容 -> 400")

    status, _, body = http(
        "POST", "/api/share/file", data=payload,
        headers=auth_headers(token, {
            "Content-Type": "application/octet-stream",
            "x-filename": urllib.parse.quote(fname),
            "x-targets": json.dumps(["ALL"]),
        }))
    assert status == 200, f"file upload failed: {status} {body[:300]}"
    data = json_of(body)
    assert data.get("success") is True and data.get("fileId"), f"upload response invalid: {data}"
    dl = data.get("downloadUrl", "")
    assert dl.startswith(f"http://{host_ip()}:{PORT}/api/share/download/"), f"downloadUrl host wrong: {dl}"
    ok("T8 檔案上傳成功", f"fileId={data['fileId']} filename={data.get('filename')!r}")

    # download roundtrip (no auth by design — agents fetch anonymously)
    dpath = urllib.parse.urlparse(dl).path
    status, dheaders, dbody = http("GET", dpath)
    assert status == 200, f"download failed: {status}"
    assert dbody == payload, "downloaded bytes differ from uploaded payload"
    assert dheaders.get("Content-Length") == str(len(payload)), "Content-Length mismatch"
    assert dheaders.get("Content-Type") == "application/octet-stream", "Content-Type mismatch"
    assert "attachment" in dheaders.get("Content-Disposition", ""), "should be attachment disposition"
    ok("T9 下載回原樣 (位元組一致 + Content-Length + octet-stream)")

    status, _, _ = http("GET", "/api/share/download/zzzzzz/no_such_file.bin")
    assert status == 404, f"unknown fileId must be 404, got {status}"
    ok("T10 不存在的 fileId 下載 -> 404")
    return data


def test_path_traversal_resistance():
    marker = b"GRIDSHIFT_TRAVERSAL_SECRET_9137"
    # fileId decodes to ../../tmp/traversal ; joined name becomes /tmp/traversal_marker
    status, _, body = http("GET", "/api/share/download/..%2F..%2Ftmp%2Ftraversal/marker")
    leaked = status == 200 and marker in body
    assert not leaked, f"SECURITY: path traversal succeeded via fileId! ({status})"
    ok("T11 路徑穿越防護：fileId 夾帶 ../ 無法讀取任意檔", f"(HTTP {status})")


def test_ws_delivery_to_mock_agent(token):
    agent = MockAgent()
    try:
        time.sleep(1.0)  # allow server to register the socket

        url = "https://example.com/lesson?id=42&lang=zh-TW"
        status, _, body = http("POST", "/api/share/url",
                               data=json.dumps({"url": url, "targets": [MOCK_MAC]}).encode(),
                               headers={**auth_headers(token), "Content-Type": "application/json"})
        assert status == 200, f"targeted share/url failed: {status} {body[:200]}"
        assert json_of(body).get("count") == 1, f"expected count=1, got {body[:200]}"
        msg = wait_for_action(agent, "OPEN_URL")
        assert msg.get("url") == url, f"OPEN_URL url mismatch: {msg}"
        ok("T12 指定 MAC 廣播網址 -> 學生端 WS 收到 OPEN_URL 且欄位正確")

        payload = os.urandom(1024) * 7  # 7 KB random file
        fname = "hw_packet_v2.pdf"
        status, _, body = http(
            "POST", "/api/share/file", data=payload,
            headers=auth_headers(token, {
                "Content-Type": "application/octet-stream",
                "x-filename": urllib.parse.quote(fname),
                "x-targets": json.dumps([MOCK_MAC]),
            }))
        assert status == 200, f"targeted share/file failed: {status} {body[:200]}"
        sent = json_of(body)
        assert sent.get("count") == 1, f"expected count=1, got {body[:200]}"

        msg = wait_for_action(agent, "SHARE_FILE")
        assert msg.get("filename") == fname, f"filename mismatch: {msg}"
        assert msg.get("fileSize") == len(payload), f"fileSize mismatch: {msg}"
        assert msg.get("url") == sent.get("downloadUrl"), f"SHARE_FILE url mismatch vs API response"
        ok("T13 指定 MAC 分享檔案 -> 學生端收到 SHARE_FILE (filename/fileSize/downloadUrl 一致)")
    finally:
        agent.close()

    time.sleep(0.5)
    status, _, body = http("POST", "/api/share/url",
                           data=json.dumps({"url": "https://example.com/offline", "targets": ["DEADBEEF0001"]}).encode(),
                           headers={**auth_headers(token), "Content-Type": "application/json"})
    assert status == 200 and json_of(body).get("count") == 0, \
        f"offline target should yield count=0, got {body[:200]}"
    ok("T14 離線 MAC 目標 -> count=0（不誤報送達）")


def host_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main():
    print("Starting GridSight Share URL/File Integration Tests...")
    print(f"Target: {BASE}\n")
    try:
        token = get_token()
        ok("T2 教師 PIN 登入取得 token（錯誤 PIN 已先被 401 拒絕）")

        test_url_share_auth_and_validation(token)
        test_url_share_no_agents(token)

        # ensure no agents connected for the no-agent tests above
        test_file_share_roundtrip(token)
        test_path_traversal_resistance()
        test_ws_delivery_to_mock_agent(token)

        print(f"\n🎉 ALL {PASS_COUNT} SHARE FEATURE TESTS PASSED!")
        return 0
    except Exception as e:
        print(f"\n❌ SHARE FEATURE TEST FAILED at step {PASS_COUNT + 1}: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
