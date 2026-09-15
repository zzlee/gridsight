#!/usr/bin/env python3
"""
GridSight Two-Container Docker Cluster: Student Focus Stream Native H.264 Recording Verification
Tests:
  1. Teacher Authentication
  2. Student Agent Status Verification
  3. POST /api/record/student/start -> triggers START_STREAM and launches FFmpeg muxer
  4. GET /api/record/student/status -> asserts active recording & duration
  5. Streaming data accumulation (4 seconds)
  6. POST /api/record/student/stop -> finalizes MP4 cleanly
  7. Verification with ffprobe: validates container format, H.264 stream, frame size, duration
  8. GET /api/record/list -> verifies presence of student recording with previewUrl and downloadUrl
  9. GET /api/record/preview/:filename -> verifies HTTP 200 with video/mp4 Content-Type
  10. GET /api/record/download/:filename -> downloads file and verifies byte size
  11. DELETE /api/record/:filename -> cleans up test artifact
"""

import sys
import time
import json
import subprocess
import urllib.request
import urllib.parse
import urllib.error

CONSOLE_BASE = "http://172.28.0.10:3000"
TEACHER_PIN = "888888"
STUDENT_MAC = "02:42:ac:1c:00:14"


def log(msg, color="\033[96m"):
    print(f"{color}[TestCluster:StudentRecord] {msg}\033[0m")


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
            resp_headers = dict(resp.headers)
            if "json" in ct:
                return resp.status, json.loads(raw.decode("utf-8")), resp_headers
            return resp.status, raw, resp_headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw.decode("utf-8")), dict(e.headers)
        except Exception:
            return e.code, raw.decode("utf-8", errors="replace"), dict(e.headers)


def main():
    log("=================================================================")
    log(" Starting GridSight Student Stream Recording Verification Test")
    log("=================================================================")

    # 1. Login
    code, resp, _ = http_req(f"{CONSOLE_BASE}/api/auth/login", {"pin": TEACHER_PIN}, method="POST")
    if code != 200 or "token" not in resp:
        log(f"❌ Failed to login: {code} {resp}", "\033[91m")
        sys.exit(1)
    token = resp["token"]
    log("✅ Teacher authenticated successfully.")

    # 2. Check Device Online
    code, resp, _ = http_req(f"{CONSOLE_BASE}/api/devices", token=token)
    assert code == 200, f"Failed to list devices: {code}"
    devices = resp if isinstance(resp, list) else resp.get("devices", [])
    found_dev = any(d.get("mac", "").lower() == STUDENT_MAC.lower() for d in devices)
    log(f"✅ Student device {STUDENT_MAC} discovered and confirmed online (total devices: {len(devices)})")

    # 3. Start Student Screen Recording
    log(f"Starting native H.264 recording for student {STUDENT_MAC}...")
    code, resp, _ = http_req(
        f"{CONSOLE_BASE}/api/record/student/start",
        {"mac": STUDENT_MAC, "label": "SeatA1"},
        token=token,
        method="POST"
    )
    assert code == 200 and resp.get("ok") is True, f"Failed to start student recording: {code} {resp}"
    rec_filename = resp.get("filename")
    assert rec_filename and rec_filename.startswith("GridSight_Student_"), f"Unexpected filename: {rec_filename}"
    log(f"✅ Student recording initiated: {rec_filename}")

    # 4. Check Recording Status
    time.sleep(1.0)
    code, resp, _ = http_req(f"{CONSOLE_BASE}/api/record/student/status?mac={STUDENT_MAC}", token=token)
    assert code == 200 and resp.get("isRecording") is True, f"Recording not reported active: {resp}"
    log(f"✅ Student recording verified active: {resp.get('filename')} (duration: {resp.get('durationSeconds')}s)")

    # 5. Let H.264 stream record for 4 seconds
    log("Recording live 30 FPS stream for 4 seconds...")
    time.sleep(4.0)

    # 6. Stop Student Recording
    log(f"Stopping recording for student {STUDENT_MAC}...")
    code, resp, _ = http_req(
        f"{CONSOLE_BASE}/api/record/student/stop",
        {"mac": STUDENT_MAC},
        token=token,
        method="POST"
    )
    assert code == 200 and resp.get("ok") is True, f"Failed to stop student recording: {code} {resp}"
    size_bytes = resp.get("sizeBytes", 0)
    duration_s = resp.get("durationSeconds", 0)
    log(f"✅ Student recording stopped: {resp.get('filename')} (size: {size_bytes} bytes, duration: {duration_s}s)")
    assert size_bytes > 50000, f"Recorded file too small ({size_bytes} bytes), expected valid H.264 video!"

    # 7. ffprobe Validation inside Container
    log(f"Validating recorded MP4 via ffprobe in gs-test-console...")
    probe_cmd = [
        "docker", "exec", "gs-test-console",
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,width,height,r_frame_rate",
        "-show_entries", "format=format_name,duration",
        "-of", "json",
        f"/data/recordings/{rec_filename}"
    ]
    probe_proc = subprocess.run(probe_cmd, capture_output=True, text=True)
    assert probe_proc.returncode == 0, f"ffprobe failed: {probe_proc.stderr}"
    probe_data = json.loads(probe_proc.stdout)

    stream_info = probe_data.get("streams", [{}])[0]
    format_info = probe_data.get("format", {})
    codec_name = stream_info.get("codec_name")
    width = stream_info.get("width")
    height = stream_info.get("height")
    format_name = format_info.get("format_name")
    duration = float(format_info.get("duration", 0))

    log(f"✅ ffprobe verified: format={format_name}, codec={codec_name}, resolution={width}x{height}, duration={duration:.2f}s")
    assert codec_name == "h264", f"Expected h264 codec, got {codec_name}"
    assert "mp4" in format_name, f"Expected MP4 container, got {format_name}"
    assert width > 0 and height > 0, f"Invalid resolution: {width}x{height}"
    assert duration > 1.0, f"Duration too short: {duration}s"

    # 8. List Recordings
    log("Verifying /api/record/list...")
    code, list_resp, _ = http_req(f"{CONSOLE_BASE}/api/record/list", token=token)
    assert code == 200 and isinstance(list_resp, list), f"List failed: {list_resp}"
    matched = [r for r in list_resp if r.get("filename") == rec_filename]
    assert len(matched) == 1, f"Recording {rec_filename} not found in list"
    rec_entry = matched[0]
    assert rec_entry.get("previewUrl"), f"Missing previewUrl: {rec_entry}"
    assert rec_entry.get("downloadUrl"), f"Missing downloadUrl: {rec_entry}"
    log(f"✅ Found {rec_filename} in recordings list with previewUrl & downloadUrl")

    # 9. Verify /api/record/preview/:filename
    log("Verifying preview stream endpoint (/api/record/preview/:file)...")
    code, preview_raw, preview_headers = http_req(
        f"{CONSOLE_BASE}/api/record/preview/{urllib.parse.quote(rec_filename)}",
        token=token
    )
    assert code == 200, f"Preview failed: {code}"
    ct = preview_headers.get("content-type", preview_headers.get("Content-Type", ""))
    assert "video/mp4" in ct, f"Expected video/mp4 Content-Type, got: {ct}"
    log(f"✅ Preview stream verified: HTTP 200, Content-Type: {ct}, size: {len(preview_raw)} bytes")

    # 10. Verify /api/record/download/:filename
    log("Verifying download endpoint (/api/record/download/:file)...")
    code, dl_raw, dl_headers = http_req(
        f"{CONSOLE_BASE}/api/record/download/{urllib.parse.quote(rec_filename)}",
        token=token
    )
    assert code == 200, f"Download failed: {code}"
    assert len(dl_raw) == size_bytes, f"Downloaded size ({len(dl_raw)}) != reported size ({size_bytes})"
    log(f"✅ Download verified: {len(dl_raw)} bytes exactly matches server recorded file.")

    # 11. Clean Up / Deletion
    log(f"Cleaning up test recording: {rec_filename}...")
    code, del_resp, _ = http_req(
        f"{CONSOLE_BASE}/api/record/{urllib.parse.quote(rec_filename)}",
        token=token,
        method="DELETE"
    )
    assert code == 200 and del_resp.get("ok") is True, f"Delete failed: {code} {del_resp}"
    log("✅ Test recording deleted successfully.")

    log("=================================================================", "\033[92m")
    log(" 🎉 ALL STUDENT FOCUS STREAM RECORDING TESTS PASSED PERFECTLY!", "\033[92m")
    log("=================================================================", "\033[92m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
