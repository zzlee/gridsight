import asyncio
import sys
import time
import websockets

def parse_nal_units(data: bytes):
    nalus = []
    i = 0
    n = len(data)
    while i < n - 3:
        if data[i] == 0 and data[i+1] == 0 and (data[i+2] == 1 or (data[i+2] == 0 and i < n - 4 and data[i+3] == 1)):
            start_code_len = 3 if data[i+2] == 1 else 4
            nal_header_idx = i + start_code_len
            if nal_header_idx < n:
                nal_type = data[nal_header_idx] & 0x1F
                nalus.append((nal_type, nal_header_idx))
            i = nal_header_idx
        else:
            i += 1
    return nalus

NAL_TYPE_NAMES = {
    1: "Non-IDR Slice (P/B frame)",
    5: "IDR Slice (Keyframe)",
    6: "SEI",
    7: "SPS (Sequence Parameter Set)",
    8: "PPS (Picture Parameter Set)",
    9: "Access Unit Delimiter",
}

async def test_stream(mac: str = "02:42:AC:1C:00:14", duration: float = 3.0):
    url = f"ws://127.0.0.1:3000/ws/stream/{mac}"
    print(f"[*] Connecting to {url}...")
    try:
        async with websockets.connect(url, ping_interval=None) as ws:
            print("[+] Connected to stream WebSocket!")
            start_time = time.time()
            frame_count = 0
            total_bytes = 0
            nal_counts = {}

            while time.time() - start_time < duration:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                except asyncio.TimeoutError:
                    print("[-] Timed out waiting for frame")
                    break

                if isinstance(msg, bytes):
                    frame_count += 1
                    total_bytes += len(msg)
                    nalus = parse_nal_units(msg)
                    types = [f"{NAL_TYPE_NAMES.get(t, f'Type {t}')} ({t})" for t, _ in nalus]
                    for t, _ in nalus:
                        nal_counts[t] = nal_counts.get(t, 0) + 1
                    
                    if frame_count <= 5 or frame_count % 15 == 0:
                        print(f"  Frame #{frame_count:03d} | Size: {len(msg):6d} bytes | NALUs: {', '.join(types) if types else 'None'}")
                else:
                    print(f"  [Text message]: {msg}")

            elapsed = time.time() - start_time
            fps = frame_count / elapsed if elapsed > 0 else 0
            kbps = (total_bytes * 8 / 1000) / elapsed if elapsed > 0 else 0

            print("\n" + "="*50)
            print(f"🎯 Stream Verification Results ({mac}):")
            print(f"  Total Frames Received: {frame_count}")
            print(f"  Total Data:            {total_bytes / 1024:.1f} KB")
            print(f"  Duration:              {elapsed:.2f} s")
            print(f"  Average FPS:           {fps:.1f} FPS")
            print(f"  Average Bitrate:       {kbps:.1f} kbps")
            print(f"  NAL Unit Breakdown:")
            for t, count in sorted(nal_counts.items()):
                print(f"    - {NAL_TYPE_NAMES.get(t, f'Type {t}')} (Type {t}): {count} occurrences")
            print("="*50)

            # Assertions
            assert frame_count > 0, "No frames received!"
            assert 7 in nal_counts, "Missing SPS (Type 7) in stream!"
            assert 8 in nal_counts, "Missing PPS (Type 8) in stream!"
            assert 5 in nal_counts, "Missing IDR Keyframe (Type 5) in stream!"
            print("\n✅ SUCCESS: Valid H.264 video stream verified!")

    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(test_stream())
