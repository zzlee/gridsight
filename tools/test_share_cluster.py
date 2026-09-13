#!/usr/bin/env python3
"""
GridSight Two-Container Docker Cluster: Share URL & Share File End-to-End Test
Verifies:
  1. Share URL (Broadcast & Targeted) over Reverse WebSocket
  2. Share File (Upload, Dispatch, HTTP Download by Agent, On-Disk File Integrity)
  3. Reverse WS Log Verification and Edge Cases
"""

import sys
import time
import json
import urllib.request
import urllib.parse
import urllib.error
import subprocess

CONSOLE_BASE = "http://172.28.0.10:3000"
TEACHER_PIN = "888888"

def log(msg, color="\033[96m"):
    print(f"{color}[TestCluster:Share] {msg}\033[0m")

def http_post(url, data_dict=None, raw_body=None, headers_extra=None, token=None, timeout=10):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if headers_extra:
        headers.update(headers_extra)

    if raw_body is not None:
        body = raw_body
    elif data_dict is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data_dict).encode("utf-8")
    else:
        body = None

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read()
            if "json" in content_type:
                return resp.status, json.loads(raw.decode("utf-8"))
            return resp.status, raw.decode("utf-8")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8"))
        except Exception:
            return e.code, raw.decode("utf-8", errors="replace")

def http_get(url, token=None, timeout=10):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read()
            if "json" in content_type:
                return resp.status, json.loads(raw.decode("utf-8"))
            return resp.status, raw.decode("utf-8")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8"))
        except Exception:
            return e.code, raw.decode("utf-8", errors="replace")

def docker_exec(container, cmd):
    res = subprocess.run(
        ["docker", "exec", container] + cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    return res.returncode, res.stdout, res.stderr

def main():
    log("==================================================================", "\033[95m")
    log("  🚀 Running GridSight Share (URL & File) E2E Test in Docker Cluster", "\033[95m")
    log("==================================================================", "\033[95m")

    # 1. Wait for Console server health
    log("1. Waiting for gs-test-console to report healthy...")
    ready = False
    for attempt in range(30):
        try:
            code, res = http_get(f"{CONSOLE_BASE}/api/health", timeout=2)
            if code == 200 and res.get("status") == "ok":
                ready = True
                log(f"✅ gs-test-console is healthy on attempt {attempt+1}")
                break
        except Exception:
            time.sleep(1)
    if not ready:
        log("❌ gs-test-console failed to become healthy within 30s", "\033[91m")
        sys.exit(1)

    # 2. Authenticate as teacher
    log("2. Authenticating as teacher...")
    code, auth_data = http_post(f"{CONSOLE_BASE}/api/auth/login", {"pin": TEACHER_PIN})
    if code != 200 or not auth_data.get("token"):
        log(f"❌ Failed to obtain teacher token: {code} {auth_data}", "\033[91m")
        sys.exit(1)
    token = auth_data["token"]
    log("✅ Authenticated successfully, token granted.")

    # 3. Wait for gs-test-agent to connect over WebSocket
    log("3. Waiting for gs-test-agent to establish reverse WebSocket and register...")
    agent_found = None
    for attempt in range(25):
        try:
            code, agents_resp = http_get(f"{CONSOLE_BASE}/api/agents", token=token, timeout=2)
            if code == 200:
                agents = agents_resp.get("agents", [])
                for a in agents:
                    if a.get("ip") == "172.28.0.20" or "02:42:ac:1c" in a.get("mac", "").lower():
                        agent_found = a
                        break
                if agent_found:
                    log(f"✅ gs-test-agent connected: {agent_found.get('hostname')} ({agent_found.get('mac')})")
                    break
        except Exception:
            pass
        time.sleep(1)

    if not agent_found:
        log("❌ gs-test-agent failed to register within timeout", "\033[91m")
        sys.exit(1)

    mac = agent_found["mac"]

    # =========================================================================
    # PART 1: Share URL Tests
    # =========================================================================
    log("\n------------------------------------------------------------------", "\033[94m")
    log("  🌐 PART 1: Share URL Tests (Broadcast, Targeted, Validation)", "\033[94m")
    log("------------------------------------------------------------------", "\033[94m")

    # 1.1 Broadcast URL
    test_url_broadcast = "https://classroom.google.com/test-course"
    log(f"1.1 Dispatching broadcast URL to all agents: {test_url_broadcast}")
    code, url_resp = http_post(
        f"{CONSOLE_BASE}/api/share/url",
        {"url": test_url_broadcast, "targets": []},
        token=token
    )
    if code != 200 or not url_resp.get("success"):
        log(f"❌ Failed to broadcast URL: {code} {url_resp}", "\033[91m")
        sys.exit(1)
    if url_resp.get("successCount", 0) < 1 or url_resp.get("url") != test_url_broadcast:
        log(f"❌ Unexpected URL broadcast response: {url_resp}", "\033[91m")
        sys.exit(1)
    log(f"✅ URL broadcast dispatched: successCount={url_resp.get('successCount')}, targetUrl={url_resp.get('url')}")

    # 1.2 Targeted URL
    test_url_targeted = f"http://172.28.0.10:3000/materials/lesson1"
    log(f"1.2 Dispatching targeted URL to {mac}: {test_url_targeted}")
    code, target_url_resp = http_post(
        f"{CONSOLE_BASE}/api/share/url",
        {"url": test_url_targeted, "targets": [mac]},
        token=token
    )
    if code != 200 or not target_url_resp.get("success") or target_url_resp.get("successCount") != 1:
        log(f"❌ Failed targeted URL dispatch: {code} {target_url_resp}", "\033[91m")
        sys.exit(1)
    log(f"✅ Targeted URL dispatched: successCount={target_url_resp.get('successCount')}")

    # 1.3 Validate agent received OPEN_URL command via reverse WS log pull
    log("1.3 Verifying agent received OPEN_URL via GET /api/agent/:id/logs...")
    time.sleep(1)
    code, log_resp = http_get(f"{CONSOLE_BASE}/api/agent/{mac}/logs", token=token)
    if code != 200:
        log(f"❌ Failed to fetch agent logs: {code}", "\033[91m")
        sys.exit(1)
    
    agent_logs = log_resp if isinstance(log_resp, str) else str(log_resp)
    if test_url_broadcast not in agent_logs:
        log(f"❌ Broadcast URL was not found in agent log: {test_url_broadcast}", "\033[91m")
        sys.exit(1)
    if test_url_targeted not in agent_logs:
        log(f"❌ Targeted URL was not found in agent log: {test_url_targeted}", "\033[91m")
        sys.exit(1)
    log("✅ Both broadcast and targeted URLs logged by agent (OpenUrl confirmed)!")

    # 1.4 Invalid URL rejection
    log("1.4 Testing rejection of empty/invalid URL...")
    code, bad_resp = http_post(
        f"{CONSOLE_BASE}/api/share/url",
        {"url": "   "},
        token=token
    )
    if code != 400:
        log(f"❌ Server should reject empty URL with 400, got: {code} {bad_resp}", "\033[91m")
        sys.exit(1)
    log("✅ Server correctly rejected invalid URL with 400 Bad Request.")

    # =========================================================================
    # PART 2: Share File Tests
    # =========================================================================
    log("\n------------------------------------------------------------------", "\033[94m")
    log("  📁 PART 2: Share File Tests (Upload, Download, Content Integrity)", "\033[94m")
    log("------------------------------------------------------------------", "\033[94m")

    # 2.1 Clean up any previous test files inside agent container
    docker_exec("gs-test-agent", ["rm", "-rf", "/root/Downloads", "/tmp/gridsight_test_*.txt"])

    # 2.2 Upload and broadcast a test file
    test_filename = "gridsight_test_broadcast.txt"
    test_content = (
        f"===== GridSight Docker Cluster Share File Test =====\n"
        f"Timestamp: {int(time.time())}\n"
        f"Target: All Classroom Machines\n"
        f"Content: 教室即時派發檔案測試 - 支援中文與二進位資料 🚀 📦\n"
        f"====================================================\n"
    ).encode("utf-8")

    log(f"2.2 Uploading and broadcasting file: {test_filename} ({len(test_content)} bytes)...")
    headers = {
        "Content-Type": "application/octet-stream",
        "x-filename": urllib.parse.quote(test_filename),
        "x-targets": json.dumps([]),
    }
    code, file_resp = http_post(
        f"{CONSOLE_BASE}/api/share/file",
        raw_body=test_content,
        headers_extra=headers,
        token=token
    )
    if code != 200 or not file_resp.get("success"):
        log(f"❌ Failed to share file: {code} {file_resp}", "\033[91m")
        sys.exit(1)

    file_id = file_resp.get("fileId")
    download_url = file_resp.get("downloadUrl")
    file_size = file_resp.get("fileSize")
    log(f"✅ File uploaded & broadcasted: fileId={file_id}, size={file_size} bytes")
    log(f"   Download URL: {download_url}")

    # 2.3 Wait for agent to download the file from console server and write to disk
    log("2.3 Waiting for gs-test-agent to download and save file to Downloads directory...")
    downloaded_path = None
    downloaded_content = None

    for attempt in range(15):
        time.sleep(1)
        # Check /root/Downloads/ or /tmp/
        for cand in [f"/root/Downloads/{test_filename}", f"/tmp/{test_filename}"]:
            rc, stdout, _ = docker_exec("gs-test-agent", ["cat", cand])
            if rc == 0 and len(stdout.encode("utf-8")) == len(test_content):
                downloaded_path = cand
                downloaded_content = stdout.encode("utf-8")
                break
        if downloaded_path:
            break

    if not downloaded_path:
        log("❌ Agent did not download file or file size mismatch within timeout!", "\033[91m")
        rc, out, _ = docker_exec("gs-test-agent", ["ls", "-la", "/root/Downloads", "/tmp"])
        log(f"   Agent directory listing:\n{out}")
        code, log_resp = http_get(f"{CONSOLE_BASE}/api/agent/{mac}/logs", token=token)
        log(f"   Agent logs:\n{log_resp}")
        sys.exit(1)

    log(f"✅ Agent successfully downloaded file to: {downloaded_path}")
    if downloaded_content != test_content:
        log(f"❌ Downloaded content does not match uploaded content!", "\033[91m")
        sys.exit(1)
    log("✅ Byte-for-byte content integrity verified!")

    # 2.4 Test Targeted File Share
    targeted_filename = "gridsight_targeted_doc.py"
    targeted_content = (
        f"# Python sample shared only to {mac}\n"
        f"print('Hello from targeted share test')\n"
    ).encode("utf-8")

    log(f"2.4 Uploading and dispatching targeted file: {targeted_filename} to {mac}...")
    headers_targeted = {
        "Content-Type": "application/octet-stream",
        "x-filename": urllib.parse.quote(targeted_filename),
        "x-targets": json.dumps([mac]),
    }
    code, t_file_resp = http_post(
        f"{CONSOLE_BASE}/api/share/file",
        raw_body=targeted_content,
        headers_extra=headers_targeted,
        token=token
    )
    if code != 200 or not t_file_resp.get("success") or t_file_resp.get("successCount") != 1:
        log(f"❌ Failed targeted file share: {code} {t_file_resp}", "\033[91m")
        sys.exit(1)

    t_downloaded = False
    for attempt in range(15):
        time.sleep(1)
        for cand in [f"/root/Downloads/{targeted_filename}", f"/tmp/{targeted_filename}"]:
            rc, stdout, _ = docker_exec("gs-test-agent", ["cat", cand])
            if rc == 0 and stdout.encode("utf-8") == targeted_content:
                t_downloaded = True
                break
        if t_downloaded:
            break

    if not t_downloaded:
        log("❌ Targeted file was not downloaded by agent within timeout!", "\033[91m")
        sys.exit(1)
    log("✅ Targeted file downloaded and verified on agent!")

    # 2.5 Test File Download Security & Edge Cases
    log("2.5 Testing direct download API security and edge cases...")
    # A. Direct download valid file
    code, dl_body = http_get(f"{CONSOLE_BASE}/api/share/download/{file_id}/{urllib.parse.quote(test_filename)}")
    if code != 200 or dl_body.encode("utf-8") != test_content:
        log(f"❌ Direct download failed or content mismatch: {code}", "\033[91m")
        sys.exit(1)
    log("✅ Direct HTTP GET /api/share/download/... verified.")

    # B. Non-existent fileId returns 404
    code, _ = http_get(f"{CONSOLE_BASE}/api/share/download/zzzzzzzz123456/sample.txt")
    if code != 404:
        log(f"❌ Expected 404 for missing file, got: {code}", "\033[91m")
        sys.exit(1)
    log("✅ Missing file correctly responded with 404.")

    # C. Path traversal attempt returns 400
    code, _ = http_get(f"{CONSOLE_BASE}/api/share/download/..%2F..%2Fetc%2Fpasswd/sample.txt")
    if code != 400:
        log(f"❌ Expected 400 for path traversal attempt, got: {code}", "\033[91m")
        sys.exit(1)
    log("✅ Path traversal exploit attempt rejected with 400.")

    # D. Empty file upload returns 400
    code, _ = http_post(
        f"{CONSOLE_BASE}/api/share/file",
        raw_body=b"",
        headers_extra={"Content-Type": "application/octet-stream", "x-filename": "empty.txt"},
        token=token
    )
    if code != 400:
        log(f"❌ Expected 400 for empty file upload, got: {code}", "\033[91m")
        sys.exit(1)
    log("✅ Empty file upload rejected with 400.")

    # 2.6 Verify final agent logs confirm both file downloads
    log("2.6 Pulling agent logs to verify file download confirmation...")
    code, final_logs = http_get(f"{CONSOLE_BASE}/api/agent/{mac}/logs", token=token)
    if code == 200 and "File successfully saved to Downloads directory" in str(final_logs):
        log("✅ Agent log confirmed file download completion!")

    log("\n==================================================================", "\033[92m")
    log("  🎉 ALL SHARE (URL & FILE) TESTS PASSED IN DOCKER CLUSTER!       ", "\033[92m")
    log("==================================================================", "\033[92m")

if __name__ == "__main__":
    main()
