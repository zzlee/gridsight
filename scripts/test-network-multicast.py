#!/usr/bin/env python3
import socket
import struct
import time
import json

MULTICAST_GROUP = '239.255.42.99'
PORT = 8888

def main():
    print(f"[Multicast Test] Sending Beacon Announcements to {MULTICAST_GROUP}:{PORT}...")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)

    for i in range(1, 71):
        payload = {
            "type": "BEACON",
            "hostname": f"PC-{i:02d}",
            "ip": f"192.168.1.{100 + i}",
            "mac": f"00:1A:2B:3C:4D:{i:02X}",
            "username": f"Student{i:02d}",
            "timestamp": int(time.time() * 1000)
        }
        data = json.dumps(payload).encode('utf-8')
        sock.sendto(data, (MULTICAST_GROUP, PORT))
        print(f"Sent beacon for PC-{i:02d}")
        time.sleep(0.02)

    print("[Multicast Test] Finished sending 70 simulated beacon packets.")

if __name__ == '__main__':
    main()
