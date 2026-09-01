#!/usr/bin/env python3
"""
E2E Integration Test for GS Input RTP Architecture (Mouse & Key state multicast on 239.255.42.100:9002).
This script:
1. Joins the UDP multicast group 239.255.42.100:9002.
2. Constructs and sends input RTP events using python socket (simulating Console sender).
3. Receives and verifies packet structure, RTP header (V=2, PT=98, seq, ts, ssrc), and payload fields.
"""

import socket
import struct
import sys
import time

MCAST_GRP = '239.255.42.100'
MCAST_PORT = 9002

def main():
    print("=== Starting E2E Input RTP Architecture Integration Test ===")

    # Create receiving multicast socket
    recv_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    recv_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    recv_sock.bind(('', MCAST_PORT))
    recv_sock.settimeout(3.0)

    mreq = struct.pack('4sl', socket.inet_aton(MCAST_GRP), socket.INADDR_ANY)
    recv_sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

    # Create sending multicast socket
    send_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    send_sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)

    # Prepare sample event
    seq_num = 100
    ts_rtp = 900000
    ssrc = 0x87654321

    event_type = 1 # MouseMove
    norm_x = 32768
    norm_y = 16384
    btn_flags = 0x01 # Left click
    scroll_delta = 120
    mod_flags = 0x02 # Shift
    key_code = 65
    timestamp_ms = int(time.time() * 1000)

    # Pack RTP Header (12 bytes)
    # Byte 0: V=2, P=0, X=0, CC=0 -> 0x80
    # Byte 1: M=0, PT=98 -> 0x62
    rtp_header = struct.pack('>BBHII', 0x80, 0x62, seq_num, ts_rtp, ssrc)

    # Pack Payload (21 bytes): >BHHBhBIQ
    payload = struct.pack('>BHHBhBIQ', event_type, norm_x, norm_y, btn_flags, scroll_delta, mod_flags, key_code, timestamp_ms)

    packet = rtp_header + payload
    assert len(packet) == 33, f"Expected 33 bytes, got {len(packet)}"

    print(f"Sending test Input RTP packet to {MCAST_GRP}:{MCAST_PORT}...")
    send_sock.sendto(packet, (MCAST_GRP, MCAST_PORT))

    try:
        data, addr = recv_sock.recvfrom(2048)
        print(f"Received packet ({len(data)} bytes) from {addr}")

        assert len(data) >= 33, f"Packet size too small: {len(data)}"

        # Parse RTP Header
        v_p_x_cc, m_pt, rx_seq, rx_ts, rx_ssrc = struct.unpack('>BBHII', data[:12])
        v = (v_p_x_cc >> 6) & 0x03
        pt = m_pt & 0x7F

        print(f"RTP Header -> V={v}, PT={pt}, Seq={rx_seq}, TS={rx_ts}, SSRC=0x{rx_ssrc:08x}")
        assert v == 2, f"Expected RTP V=2, got {v}"
        assert pt == 98, f"Expected Payload Type 98, got {pt}"
        assert rx_seq == seq_num, f"Expected Seq {seq_num}, got {rx_seq}"
        assert rx_ssrc == ssrc, f"Expected SSRC 0x{ssrc:08x}, got 0x{rx_ssrc:08x}"

        # Parse Payload
        rx_ev_type, rx_x, rx_y, rx_btn, rx_scroll, rx_mod, rx_key, rx_ts_ms = struct.unpack('>BHHBhBIQ', data[12:33])
        print(f"Payload -> EvType={rx_ev_type}, Pos=({rx_x},{rx_y}), Btn={rx_btn}, Scroll={rx_scroll}, Mod={rx_mod}, Key={rx_key}, Ts={rx_ts_ms}")

        assert rx_ev_type == event_type, "Event type mismatch"
        assert rx_x == norm_x, "X coordinate mismatch"
        assert rx_y == norm_y, "Y coordinate mismatch"
        assert rx_btn == btn_flags, "Button flags mismatch"
        assert rx_scroll == scroll_delta, "Scroll delta mismatch"
        assert rx_mod == mod_flags, "Modifier flags mismatch"
        assert rx_key == key_code, "Key code mismatch"
        assert rx_ts_ms == timestamp_ms, "Timestamp mismatch"

        print("🎉 E2E Input RTP Integration Test PASSED successfully!")
        return 0
    except socket.timeout:
        print("❌ Error: Socket timeout waiting for multicast Input RTP packet")
        return 1
    finally:
        recv_sock.close()
        send_sock.close()

if __name__ == '__main__':
    sys.exit(main())
