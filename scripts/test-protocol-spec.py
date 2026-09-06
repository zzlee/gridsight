#!/usr/bin/env python3
"""
Protocol Specification Integration Test Suite for GridSight
Verifies server endpoints, headers, snapshot push/pull, and protocol compliance.
"""

import sys
import base64
import urllib.request
import json
import os

PORT = os.environ.get("PORT", "3000")
BASE_URL = os.environ.get("BASE_URL", f"http://127.0.0.1:{PORT}")

def test_health():
    url = f"{BASE_URL}/api/health"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=3) as resp:
        assert resp.status == 200, f"Health check failed with status {resp.status}"
        data = json.loads(resp.read().decode("utf-8"))
        assert data.get("status") == "ok", f"Health status invalid: {data}"
    print("✅ /api/health endpoint test passed.")

def test_server_info():
    url = f"{BASE_URL}/api/server-info"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=3) as resp:
        assert resp.status == 200, f"Server info check failed with status {resp.status}"
        data = json.loads(resp.read().decode("utf-8"))
        assert "version" in data, f"Server info missing version: {data}"
    print("✅ /api/server-info endpoint test passed.")

def test_agent_snapshot_push_and_fetch():
    test_mac = "00:1A:2B:3C:4D:99"
    test_ip = "192.168.1.199"
    test_window_title = "Visual Studio Code - main.cpp"
    b64_window = base64.b64encode(test_window_title.encode("utf-8")).decode("utf-8")
    dummy_jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xd9"

    import socket
    import urllib.parse

    parsed_base = urllib.parse.urlparse(BASE_URL)
    target_host = parsed_base.hostname or "127.0.0.1"

    # Obtain a valid token via UDP multicast announcement simulation
    udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_sock.settimeout(2.0)
    beacon_payload = json.dumps({"type": "BEACON", "mac": test_mac, "hostname": "MockAgentTest"})
    udp_sock.sendto(beacon_payload.encode(), (target_host, 8888))
    try:
        resp, _ = udp_sock.recvfrom(2048)
        grant = json.loads(resp.decode())
        agent_token = grant["token"]
    except Exception as e:
        raise AssertionError(f"Failed to acquire valid agent token via UDP beacon: {e}")
    finally:
        udp_sock.close()

    # 1. Test POST /api/agent/snapshot
    push_url = f"{BASE_URL}/api/agent/snapshot"
    req = urllib.request.Request(
        push_url,
        data=dummy_jpeg,
        headers={
            "X-Agent-MAC": test_mac,
            "X-Agent-IP": test_ip,
            "X-Active-Window": b64_window,
            "X-Auth-Token": agent_token,
            "Content-Type": "image/jpeg"
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=3) as resp:
        assert resp.status == 200, f"Snapshot push failed: {resp.status}"
        res_data = json.loads(resp.read().decode("utf-8"))
        assert res_data.get("status") == "ok", f"Unexpected push response: {res_data}"
    print("✅ POST /api/agent/snapshot test passed.")

    # 2. Test GET /api/snapshot/:id
    login_url = f"{BASE_URL}/api/auth/login"
    login_payload = json.dumps({"pin": "888888"}).encode("utf-8")
    login_req = urllib.request.Request(login_url, data=login_payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(login_req, timeout=3) as resp:
        teacher_token = json.loads(resp.read().decode("utf-8")).get("token")

    fetch_url = f"{BASE_URL}/api/snapshot/{test_mac}"
    req = urllib.request.Request(fetch_url, headers={"Authorization": f"Bearer {teacher_token}"})
    with urllib.request.urlopen(req, timeout=3) as resp:
        assert resp.status == 200, f"Snapshot fetch failed: {resp.status}"
        assert resp.headers.get("Content-Type") == "image/jpeg", "Invalid Content-Type header"
        body = resp.read()
        assert len(body) == len(dummy_jpeg), "Fetched snapshot payload size mismatch"
    print("✅ GET /api/snapshot/:id test passed.")

def test_install_script():
    url = f"{BASE_URL}/install-agent.ps1"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=3) as resp:
        assert resp.status == 200, f"Install script failed: {resp.status}"
        content = resp.read().decode("utf-8")
        assert "gs-agent.exe" in content, "Install script missing executable name"
    print("✅ GET /install-agent.ps1 test passed.")

def test_agent_logs():
    # 1. Test unauthorized request without auth token
    url = f"{BASE_URL}/api/agent/UNKNOWN_MAC/logs"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            assert False, "Expected 401 Unauthorized for logs endpoint without token"
    except urllib.error.HTTPError as err:
        assert err.code == 401, f"Expected 401, got {err.code}"

    # 2. Test authorized request with PIN login
    login_url = f"{BASE_URL}/api/auth/login"
    login_payload = json.dumps({"pin": "888888"}).encode("utf-8")
    login_req = urllib.request.Request(login_url, data=login_payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(login_req, timeout=3) as resp:
        token = json.loads(resp.read().decode("utf-8")).get("token")

    auth_logs_url = f"{BASE_URL}/api/agent/NON_EXISTENT_AGENT/logs"
    auth_req = urllib.request.Request(auth_logs_url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(auth_req, timeout=3) as resp:
            assert False, "Expected 404 for non-existent agent logs"
    except urllib.error.HTTPError as err:
        assert err.code == 404, f"Expected 404 for non-existent agent, got {err.code}"

    print("✅ GET /api/agent/:id/logs test passed.")

def main():
    print("Starting GridSight Protocol Specification Integration Tests...")
    try:
        test_health()
        test_server_info()
        test_agent_snapshot_push_and_fetch()
        test_install_script()
        test_agent_logs()
        print("\n🎉 ALL PROTOCOL INTEGRATION TESTS PASSED SUCCESSFULLY!")
        return 0
    except Exception as e:
        print(f"\n❌ PROTOCOL TEST FAILED: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
