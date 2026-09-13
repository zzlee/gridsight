#!/usr/bin/env python3
"""
GridSight Two-Container Docker Cluster: Teacher & Student Screen Recording E2E Test
Verifies:
  1. Teacher login and authentication
  2. Standalone teacher screen recording lifecycle (/api/record/start -> status -> stop)
  3. Synchronous broadcast + recording dual-mode lifecycle
  4. Student focus stream native H.264 recording (/api/record/student/start -> status -> stop)
  5. Recording file management: listing (/api/record/list), download (/api/record/download/:file)
  6. Path traversal security defenses on download and deletion
  7. Recording file deletion (/api/record/:file)
"""

import sys
import time
import json
import urllib.request
import urllib.parse
import urllib.error

CONSOLE_BASE = "http://172.28.0.10:3000"
TEACHER_PIN = "888888"


def log(msg, color="\033[96m"):
    print(f"{color}[TestCluster:Recording] {msg}\033[0m")


def http_req(url, data_dict=None, token=None, method="GET", timeout=10):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = None
    if data_dict is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data_dict).encode("utf-8")

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            ct = resp.headers.get("Content-Type", "")
            if "json" in ct:
                return resp.status, json.loads(raw.decode("utf-8"))
            return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8"))
        except Exception:
            return e.code, raw.decode("utf-8", errors="replace")


def main():
    log("=================================================================")
    log(" Starting GridSight Recording (Teacher & Student) Cluster Test")
    log("=================================================================")

    # 1. Login
    code, resp = http_req(f"{CONSOLE_BASE}/api/auth/login", {"pin": TEACHER_PIN}, method="POST")
    if code != 200 or "token" not in resp:
        log(f"❌ Failed to login: {code} {resp}", "\033[91m")
        sys.exit(1)
    token = resp["token"]
    log("✅ Teacher authenticated successfully.")

    # 2. Audio devices query
    code, resp = http_req(f"{CONSOLE_BASE}/api/record/audio-devices", token=token)
    assert code == 200 and resp.get("ok") is True, f"audio devices failed: {resp}"
    log(f"✅ Audio input devices listed: {len(resp.get('devices', []))} device(s)")

    # 3. Standalone Teacher Screen Recording
    log("Testing Teacher standalone screen recording...")
    code, resp = http_req(
        f"{CONSOLE_BASE}/api/record/start",
        {"quality": "low", "audioDevice": "none"},
        token=token,
        method="POST"
    )
    assert code == 200 and resp.get("isRecording") is True, f"record start failed: {resp}"
    rec_filename = resp.get("filename")
    log(f"✅ Teacher screen recording started: {rec_filename}")

    # Check status
    time.sleep(1.5)
    code, resp = http_req(f"{CONSOLE_BASE}/api/record/status", token=token)
    assert code == 200 and resp.get("isRecording") is True, f"record status failed: {resp}"
    assert resp.get("isRecordOnly") is True, "Must be recordOnly mode"
    log(f"✅ Teacher recording active (duration: {resp.get('durationSeconds')}s)")

    # Stop standalone recording
    code, resp = http_req(f"{CONSOLE_BASE}/api/record/stop", {}, token=token, method="POST")
    assert code == 200 and resp.get("status") == "stopped", f"record stop failed: {resp}"
    file_info = resp.get("fileInfo") or {}
    assert file_info.get("sizeBytes", 0) > 0, "Recorded file must be > 0 bytes"
    log(f"✅ Teacher recording stopped (size: {file_info.get('sizeBytes')} bytes)")

    # 4. Teacher Synchronous Recording during Broadcast
    log("Testing Teacher synchronous broadcast + recording dual-mode...")
    code, resp = http_req(
        f"{CONSOLE_BASE}/api/broadcast/start",
        {"fps": 30, "bitrateKbps": 2000, "record": True, "audioDevice": "none"},
        token=token,
        method="POST"
    )
    assert code == 200 and resp.get("active") is True, f"broadcast start failed: {resp}"

    time.sleep(1.5)
    code, resp = http_req(f"{CONSOLE_BASE}/api/record/status", token=token)
    assert code == 200 and resp.get("isRecording") is True and resp.get("isBroadcasting") is True, f"status: {resp}"
    log(f"✅ Dual-mode broadcast + sync recording live: {resp.get('filename')}")

    code, resp = http_req(f"{CONSOLE_BASE}/api/broadcast/stop", {}, token=token, method="POST")
    assert code == 200 and resp.get("active") is False, f"broadcast stop failed: {resp}"

    code, resp = http_req(f"{CONSOLE_BASE}/api/record/status", token=token)
    assert code == 200 and resp.get("isRecording") is False, f"post-stop status: {resp}"
    log("✅ Dual-mode broadcast & recording stopped cleanly.")

    # 5. Student Recording API
    log("Testing Student Focus Stream native H.264 recording...")
    mock_student_mac = "02:42:ac:1c:00:14"  # matches test-agent in docker-compose.test-cluster.yml

    code, resp = http_req(
        f"{CONSOLE_BASE}/api/record/student/start",
        {"mac": mock_student_mac, "label": "DockerAgent"},
        token=token,
        method="POST"
    )
    assert code == 200 and resp.get("ok") is True, f"student record start failed: {resp}"
    student_rec_file = resp.get("filename")
    log(f"✅ Student recording started: {student_rec_file}")

    # Check status
    code, resp = http_req(f"{CONSOLE_BASE}/api/record/student/status?mac={mock_student_mac}", token=token)
    assert code == 200 and resp.get("isRecording") is True, f"student record status: {resp}"
    log(f"✅ Student recording active: {resp.get('filename')}")

    time.sleep(1.0)
    code, resp = http_req(
        f"{CONSOLE_BASE}/api/record/student/stop",
        {"mac": mock_student_mac},
        token=token,
        method="POST"
    )
    assert code == 200 and resp.get("ok") is True, f"student record stop: {resp}"
    log(f"✅ Student recording stopped successfully: {resp.get('filename')}")

    # 6. Recording List & Download
    log("Testing recording listing and download...")
    code, resp = http_req(f"{CONSOLE_BASE}/api/record/list", token=token)
    assert code == 200 and isinstance(resp, list) and len(resp) >= 2, f"list failed: {resp}"
    target_dl = resp[0]["filename"]
    log(f"✅ Recording list verified ({len(resp)} files found, latest: {target_dl})")

    code, raw_bytes = http_req(f"{CONSOLE_BASE}/api/record/download/{urllib.parse.quote(target_dl)}", token=token)
    assert code == 200 and len(raw_bytes) > 0, f"download failed: {code}"
    log(f"✅ Downloaded {len(raw_bytes)} bytes of {target_dl}")

    # 7. Security: Path Traversal Tests
    log("Testing path traversal security defenses...")
    code, _ = http_req(f"{CONSOLE_BASE}/api/record/download/..%2F..%2Fetc%2Fpasswd", token=token)
    assert code in (403, 404), f"Traversal download not blocked: {code}"

    code, _ = http_req(f"{CONSOLE_BASE}/api/record/..%2F..%2Fetc%2Fpasswd", token=token, method="DELETE")
    assert code in (403, 404), f"Traversal delete not blocked: {code}"
    log("✅ Path traversal attacks on download and delete safely blocked (403/404)")

    # 8. Deletion Test
    log(f"Deleting test recording: {target_dl}...")
    code, resp = http_req(f"{CONSOLE_BASE}/api/record/{urllib.parse.quote(target_dl)}", token=token, method="DELETE")
    assert code == 200 and resp.get("ok") is True, f"delete failed: {code} {resp}"
    log("✅ Recording deleted successfully via API.")

    log("=================================================================", "\033[92m")
    log(" 🎉 ALL RECORDING (TEACHER & STUDENT) TESTS PASSED SUCCESSFULLY!", "\033[92m")
    log("=================================================================", "\033[92m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
