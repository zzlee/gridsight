#!/usr/bin/env python3
"""
GridSight Two-Container Docker Cluster: Roll Call End-to-End Test
Verifies roll call dispatch, WebSocket response from gs-agent,
status tracking, individual target re-prompting, and CSV export.
"""

import sys
import time
import json
import urllib.request
import urllib.error

CONSOLE_BASE = "http://172.28.0.10:3000"
TEACHER_PIN = "888888"

def log(msg, color="\033[96m"):
    print(f"{color}[TestCluster:RollCall] {msg}\033[0m")

def http_post(url, data_dict=None, token=None, timeout=10):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data_dict).encode("utf-8") if data_dict is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def http_get(url, token=None, timeout=10):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        content_type = resp.headers.get("Content-Type", "")
        raw = resp.read()
        if "json" in content_type:
            return json.loads(raw.decode("utf-8"))
        return raw.decode("utf-8")

def main():
    log("==================================================================", "\033[95m")
    log("  🚀 Running GridSight Roll Call E2E Test in Docker Cluster", "\033[95m")
    log("==================================================================", "\033[95m")

    # 1. Wait for Console server health
    log("1. Waiting for gs-test-console to report healthy...")
    ready = False
    for attempt in range(30):
        try:
            res = http_get(f"{CONSOLE_BASE}/api/health", timeout=2)
            if res.get("status") == "ok":
                ready = True
                log(f"✅ gs-test-console is healthy on attempt {attempt+1}")
                break
        except Exception:
            time.sleep(1)
    if not ready:
        log("❌ gs-test-console failed to become healthy within 30s", "\033[91m")
        sys.exit(1)

    # 2. Login to get teacher PIN token
    log("2. Authenticating as teacher...")
    auth_data = http_post(f"{CONSOLE_BASE}/api/auth/login", {"pin": TEACHER_PIN})
    token = auth_data.get("token")
    if not token:
        log(f"❌ Failed to obtain teacher token: {auth_data}", "\033[91m")
        sys.exit(1)
    log("✅ Authenticated successfully, token granted.")

    # 3. Wait for gs-test-agent to connect over WebSocket
    log("3. Waiting for gs-test-agent to establish reverse WebSocket and register...")
    agent_found = None
    for attempt in range(25):
        try:
            agents_resp = http_get(f"{CONSOLE_BASE}/api/agents", token=token, timeout=2)
            agents = agents_resp.get("agents", [])
            for a in agents:
                if a.get("ip") == "172.28.0.20" or "02:42:ac:1c" in a.get("mac", "").lower():
                    agent_found = a
                    break
            if agent_found:
                log(f"✅ gs-test-agent connected: {agent_found.get('hostname')} ({agent_found.get('mac')})")
                break
        except Exception as e:
            pass
        time.sleep(1)

    if not agent_found:
        log("❌ gs-test-agent failed to register within timeout", "\033[91m")
        sys.exit(1)

    mac = agent_found["mac"]

    # 4. Dispatch full-class roll call
    log("4. Dispatching full-class roll call via POST /api/rollcall/start...")
    start_resp = http_post(
        f"{CONSOLE_BASE}/api/rollcall/start",
        {"title": "Docker叢集實境點名測試"},
        token=token,
    )
    if not start_resp.get("ok"):
        log(f"❌ Failed to start roll call: {start_resp}", "\033[91m")
        sys.exit(1)
    session_id = start_resp["session"]["id"]
    log(f"✅ Roll call initiated (ID: {session_id}, targets: {start_resp.get('targetCount')})")

    # 5. Wait for agent to automatically respond over WebSocket (Linux stub)
    log("5. Waiting for gs-test-agent to receive WS command and reply with student ID...")
    checked_in = False
    student_id = None
    for _ in range(15):
        time.sleep(1)
        status_resp = http_get(f"{CONSOLE_BASE}/api/rollcall/status", token=token)
        records = status_resp.get("session", {}).get("records", [])
        for r in records:
            if r.get("mac", "").lower() == mac.lower() and r.get("studentId"):
                checked_in = True
                student_id = r.get("studentId")
                break
        if checked_in:
            break

    if not checked_in:
        log(f"❌ gs-test-agent did not check in within timeout. Status: {status_resp}", "\033[91m")
        sys.exit(1)
    log(f"✅ Student checked in via WebSocket! Student ID: {student_id}", "\033[92m")

    # 6. Verify /api/agents reports updated studentId and hasCheckedIn
    log("6. Verifying /api/agents roster state...")
    roster_resp = http_get(f"{CONSOLE_BASE}/api/agents", token=token)
    matched = next((a for a in roster_resp.get("agents", []) if a.get("mac", "").lower() == mac.lower()), None)
    if not matched or matched.get("studentId") != student_id or not matched.get("hasCheckedIn"):
        log(f"❌ /api/agents does not reflect check-in state: {matched}", "\033[91m")
        sys.exit(1)
    log(f"✅ /api/agents confirmed: studentId={matched.get('studentId')}, hasCheckedIn={matched.get('hasCheckedIn')}")

    # 7. Test targeted re-prompt for specific student
    log("7. Testing individual student re-prompt (POST /api/rollcall/start with targets)...")
    reprompt_resp = http_post(
        f"{CONSOLE_BASE}/api/rollcall/start",
        {"targets": [mac]},
        token=token,
    )
    if not reprompt_resp.get("ok") or reprompt_resp.get("targetCount") != 1:
        log(f"❌ Targeted re-prompt failed: {reprompt_resp}", "\033[91m")
        sys.exit(1)
    log("✅ Targeted re-prompt successfully dispatched to target student.")

    # 8. Test CSV export
    log("8. Testing CSV export via GET /api/rollcall/export-csv...")
    csv_text = http_get(f"{CONSOLE_BASE}/api/rollcall/export-csv", token=token)
    if student_id not in csv_text or "已簽到" not in csv_text:
        log(f"❌ CSV content missing expected student ID or status: {csv_text}", "\033[91m")
        sys.exit(1)
    log("✅ CSV export verified! Content sample:\n" + "\n".join(csv_text.strip().splitlines()[:3]))

    # 9. Stop roll call
    log("9. Stopping roll call via POST /api/rollcall/stop...")
    stop_resp = http_post(f"{CONSOLE_BASE}/api/rollcall/stop", token=token)
    if not stop_resp.get("ok"):
        log(f"❌ Failed to stop roll call: {stop_resp}", "\033[91m")
        sys.exit(1)

    final_status = http_get(f"{CONSOLE_BASE}/api/rollcall/status", token=token)
    if final_status.get("active") is not False:
        log(f"❌ Roll call still reported active after stop: {final_status}", "\033[91m")
        sys.exit(1)
    log("✅ Roll call successfully stopped.")

    log("==================================================================", "\033[92m")
    log("  🎉 ALL ROLL CALL TESTS PASSED SUCCESSFULLY IN DOCKER CLUSTER!  ", "\033[92m")
    log("==================================================================", "\033[92m")

if __name__ == "__main__":
    main()
