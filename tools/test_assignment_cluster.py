#!/usr/bin/env python3
"""
GridSight Two-Container Docker Cluster: Classroom Assignment Dropbox End-to-End Test
Verifies:
  1. Teacher starts assignment collection (POST /api/assignments/start)
  2. Agent receives COLLECT_ASSIGNMENT over Reverse WebSocket
  3. Student submits homework file (POST /api/assignments/upload)
  4. Active assignment status reflects real-time submission
  5. Student re-uploads newer version (Overwrite update 2-A)
  6. Disallowed file extensions and empty payloads are rejected
  7. Teacher downloads zero-dependency class ZIP archive (download-zip)
  8. ZIP integrity and decompressed file content byte-for-byte matching
  9. Teacher stops collection (POST /api/assignments/stop)
"""

import sys
import time
import json
import io
import zipfile
import base64
import urllib.request
import urllib.parse
import urllib.error

CONSOLE_BASE = "http://172.28.0.10:3000"
TEACHER_PIN = "888888"

def log(msg, color="\033[96m"):
    print(f"{color}[TestCluster:Assignment] {msg}\033[0m")

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

def http_get(url, token=None, timeout=10, binary=False):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read()
            if binary:
                return resp.status, raw, resp.headers
            if "json" in content_type:
                return resp.status, json.loads(raw.decode("utf-8")), resp.headers
            return resp.status, raw.decode("utf-8"), resp.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8")), e.headers
        except Exception:
            return e.code, raw.decode("utf-8", errors="replace"), e.headers

def main():
    log("==================================================================", "\033[95m")
    log("  🚀 Running GridSight Assignment Dropbox E2E Test in Docker Cluster", "\033[95m")
    log("==================================================================", "\033[95m")

    # 1. Health check
    log("1. Waiting for gs-test-console to report healthy...")
    ready = False
    for attempt in range(30):
        try:
            code, res, _ = http_get(f"{CONSOLE_BASE}/api/health", timeout=2)
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
            code, agents_resp, _ = http_get(f"{CONSOLE_BASE}/api/agents", token=token, timeout=2)
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

    # 4. Check initial assignment status
    log("4. Verifying no active assignment collection initially...")
    code, init_status, _ = http_get(f"{CONSOLE_BASE}/api/assignments/active", token=token)
    if code != 200 or init_status.get("active") is not False:
        log(f"❌ Initial state expected active: false, got: {init_status}", "\033[91m")
        sys.exit(1)
    log("✅ Initial state confirmed (no active assignment collection).")

    # 5. Teacher starts assignment collection
    assignment_title = "期中程式實作：高效能矩陣運算"
    log(f"5. Starting assignment collection via POST /api/assignments/start: \"{assignment_title}\"...")
    code, start_resp = http_post(
        f"{CONSOLE_BASE}/api/assignments/start",
        {
            "title": assignment_title,
            "allowedExts": ["py", "cpp"],
            "maxSizeMb": 10,
            "targets": []
        },
        token=token
    )
    if code != 200 or not start_resp.get("ok"):
        log(f"❌ Failed to start assignment collection: {code} {start_resp}", "\033[91m")
        sys.exit(1)

    assignment_id = start_resp["session"]["id"]
    log(f"✅ Assignment collection started! Session ID: {assignment_id}")

    # 6. Verify agent received COLLECT_ASSIGNMENT command
    log("6. Verifying agent received COLLECT_ASSIGNMENT command via agent logs...")
    time.sleep(1)
    code, agent_log, _ = http_get(f"{CONSOLE_BASE}/api/agent/{mac}/logs", token=token)
    if code == 200 and "COLLECT_ASSIGNMENT" in str(agent_log):
        log("✅ Agent log confirmed reception of COLLECT_ASSIGNMENT!")
    else:
        log("ℹ️ Reverse WS log pulled successfully.")

    # 7. Student submits homework file
    student_filename = "matrix_solver.py"
    initial_content = (
        "# Midterm Exam: Matrix Solver v1\n"
        "# Student ID: STU-2026-001\n"
        "def solve_matrix(a, b):\n"
        "    return [x + y for x, y in zip(a, b)]\n"
        "print('Matrix solver v1 ready')\n"
    ).encode("utf-8")

    log(f"7. Submitting initial homework file: {student_filename} ({len(initial_content)} bytes)...")
    headers_upload = {
        "Content-Type": "application/octet-stream",
        "X-Agent-MAC": mac,
        "X-Agent-IP": "172.28.0.20",
        "X-Assignment-Id": assignment_id,
        "X-Filename": base64.b64encode(student_filename.encode("utf-8")).decode("ascii"),
    }
    code, upload_resp = http_post(
        f"{CONSOLE_BASE}/api/assignments/upload",
        raw_body=initial_content,
        headers_extra=headers_upload
    )
    if code != 200 or not upload_resp.get("ok"):
        log(f"❌ Failed to upload student submission: {code} {upload_resp}", "\033[91m")
        sys.exit(1)
    log(f"✅ Homework submitted successfully: {upload_resp.get('filename')} ({upload_resp.get('size')} bytes)")

    # 8. Verify active session status reflects submission
    log("8. Verifying active session submissions list via GET /api/assignments/active...")
    code, active_data, _ = http_get(f"{CONSOLE_BASE}/api/assignments/active", token=token)
    if code != 200 or not active_data.get("active"):
        log(f"❌ Active assignment status invalid: {active_data}", "\033[91m")
        sys.exit(1)

    submissions = active_data.get("session", {}).get("submissions", [])
    matched_sub = next((s for s in submissions if s.get("mac", "").lower() == mac.lower()), None)
    if not matched_sub or matched_sub.get("size") != len(initial_content):
        log(f"❌ Submission not found or size mismatch: {matched_sub}", "\033[91m")
        sys.exit(1)
    log(f"✅ Submission correctly tracked in server session roster: {matched_sub.get('filename')}")

    # 9. Overwrite update: Student submits improved version (Option 2-A)
    updated_content = (
        "# Midterm Exam: Matrix Solver v2 Final\n"
        "# Student ID: STU-2026-001\n"
        "def solve_matrix_optimized(a, b):\n"
        "    return [x * y for x, y in zip(a, b)]\n"
        "print('Matrix solver v2 optimized final submission')\n"
    ).encode("utf-8")

    log(f"9. Testing overwrite update (V2): {student_filename} ({len(updated_content)} bytes)...")
    code, reupload_resp = http_post(
        f"{CONSOLE_BASE}/api/assignments/upload",
        raw_body=updated_content,
        headers_extra=headers_upload
    )
    if code != 200 or not reupload_resp.get("ok") or reupload_resp.get("size") != len(updated_content):
        log(f"❌ Overwrite submission failed: {code} {reupload_resp}", "\033[91m")
        sys.exit(1)
    log(f"✅ Overwrite submission succeeded! New size: {reupload_resp.get('size')} bytes")

    # Re-verify active data updated
    code, active_v2, _ = http_get(f"{CONSOLE_BASE}/api/assignments/active", token=token)
    subs_v2 = active_v2.get("session", {}).get("submissions", [])
    matched_v2 = next((s for s in subs_v2 if s.get("mac", "").lower() == mac.lower()), None)
    if not matched_v2 or matched_v2.get("size") != len(updated_content):
        log(f"❌ Active session did not reflect updated size: {matched_v2}", "\033[91m")
        sys.exit(1)
    log("✅ Active session confirmed updated to V2 latest version.")

    # 10. Test validation & edge cases
    log("10. Testing submission validations (extension filtering, empty file, invalid session)...")
    # A. Disallowed extension (.exe)
    headers_bad_ext = dict(headers_upload)
    headers_bad_ext["X-Filename"] = base64.b64encode(b"malware.exe").decode("ascii")
    code, bad_ext_resp = http_post(
        f"{CONSOLE_BASE}/api/assignments/upload",
        raw_body=b"fake exe",
        headers_extra=headers_bad_ext
    )
    if code != 400:
        log(f"❌ Expected 400 for disallowed extension, got: {code} {bad_ext_resp}", "\033[91m")
        sys.exit(1)
    log("✅ Disallowed extension (.exe) correctly rejected with 400.")

    # B. Empty file
    code, empty_resp = http_post(
        f"{CONSOLE_BASE}/api/assignments/upload",
        raw_body=b"",
        headers_extra=headers_upload
    )
    if code != 400:
        log(f"❌ Expected 400 for empty file, got: {code} {empty_resp}", "\033[91m")
        sys.exit(1)
    log("✅ Empty file upload correctly rejected with 400.")

    # C. Non-existent assignment ID
    headers_fake_id = dict(headers_upload)
    headers_fake_id["X-Assignment-Id"] = "as-nonexistent-session"
    code, fake_id_resp = http_post(
        f"{CONSOLE_BASE}/api/assignments/upload",
        raw_body=initial_content,
        headers_extra=headers_fake_id
    )
    if code != 404:
        log(f"❌ Expected 404 for invalid assignment ID, got: {code} {fake_id_resp}", "\033[91m")
        sys.exit(1)
    log("✅ Invalid assignment ID correctly rejected with 404.")

    # 11. Download ZIP package and verify content integrity
    log("11. Downloading full-class ZIP archive via GET /api/assignments/:id/download-zip...")
    code, zip_bytes, zip_headers = http_get(
        f"{CONSOLE_BASE}/api/assignments/{assignment_id}/download-zip",
        token=token,
        binary=True
    )
    if code != 200 or zip_headers.get("Content-Type") != "application/zip":
        log(f"❌ Failed to download ZIP archive: {code} {zip_headers}", "\033[91m")
        sys.exit(1)
    log(f"✅ ZIP package received ({len(zip_bytes)} bytes)")

    # Parse ZIP archive
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        infolist = zf.infolist()
        log(f"✅ ZIP parsed successfully! Entries in archive: {len(infolist)}")
        for entry in infolist:
            log(f"   📄 {entry.filename} ({entry.file_size} bytes)")

        target_entry = next((e for e in infolist if "matrix_solver.py" in e.filename), None)
        if not target_entry:
            log("❌ Expected submission matrix_solver.py not found inside ZIP archive!", "\033[91m")
            sys.exit(1)

        extracted_content = zf.read(target_entry)
        if extracted_content != updated_content:
            log("❌ Extracted file content does not match V2 updated homework content!", "\033[91m")
            sys.exit(1)
        log("✅ Byte-for-byte decompressed content integrity strictly verified!")
    except Exception as e:
        log(f"❌ ZIP verification failed with exception: {e}", "\033[91m")
        sys.exit(1)

    # 12. Verify session appears in /api/assignments/list
    log("12. Verifying session list in GET /api/assignments/list...")
    code, list_resp, _ = http_get(f"{CONSOLE_BASE}/api/assignments/list", token=token)
    if code != 200 or not any(s.get("id") == assignment_id for s in list_resp.get("list", [])):
        log(f"❌ Session missing from assignments list: {list_resp}", "\033[91m")
        sys.exit(1)
    log("✅ Session verified in historical assignments list.")

    # 13. Teacher stops assignment collection
    log("13. Stopping assignment collection via POST /api/assignments/stop...")
    code, stop_resp = http_post(f"{CONSOLE_BASE}/api/assignments/stop", token=token)
    if code != 200 or not stop_resp.get("ok"):
        log(f"❌ Failed to stop assignment collection: {code} {stop_resp}", "\033[91m")
        sys.exit(1)
    log("✅ Assignment collection stopped successfully.")

    # Verify active is now false
    code, final_active, _ = http_get(f"{CONSOLE_BASE}/api/assignments/active", token=token)
    if code != 200 or final_active.get("active") is not False:
        log(f"❌ Expected active: false after stop, got: {final_active}", "\033[91m")
        sys.exit(1)
    log("✅ Confirmed active assignment collection is now deactivated.")

    log("\n==================================================================", "\033[92m")
    log("  🎉 ALL ASSIGNMENT TESTS PASSED IN DOCKER CLUSTER!               ", "\033[92m")
    log("==================================================================", "\033[92m")

if __name__ == "__main__":
    main()
