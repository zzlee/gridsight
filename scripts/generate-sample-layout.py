#!/usr/bin/env python3
import json

def generate_70_seat_layout():
    seats = []
    count = 1
    # 7 rows, left 5 + right 5 (center aisle)
    for r in range(7):
        for c in range(5):
            seats.append({
                "id": f"PC-{count:02d}",
                "hostname": f"PC-{count:02d}",
                "ip": f"192.168.1.{100 + count}",
                "mac": f"00:1A:2B:3C:4D:{count:02X}",
                "username": f"Student{count:02d}",
                "seatNo": f"L{r+1}-{c+1}",
                "gridX": c,
                "gridY": r + 1,
                "status": "online",
                "latencyMs": 14,
                "lastSeen": 1723812345000
            })
            count += 1
        for c in range(6, 11):
            seats.append({
                "id": f"PC-{count:02d}",
                "hostname": f"PC-{count:02d}",
                "ip": f"192.168.1.{100 + count}",
                "mac": f"00:1A:2B:3C:4D:{count:02X}",
                "username": f"Student{count:02d}",
                "seatNo": f"R{r+1}-{c-5}",
                "gridX": c,
                "gridY": r + 1,
                "status": "online",
                "latencyMs": 16,
                "lastSeen": 1723812345000
            })
            count += 1

    layout = {
        "id": "layout-sample-70",
        "name": "70人電腦教室標準雙分區座位表",
        "rows": 9,
        "cols": 11,
        "seats": seats,
        "aisles": [
            {"id": "aisle-center", "type": "vertical", "index": 5, "label": "中央走道"}
        ],
        "obstacles": [
            {"id": "obs-podium", "gridX": 4, "gridY": 0, "width": 3, "height": 1, "label": "講台 / 黑板", "type": "podium"}
        ]
    }

    with open("/working_dir/c_f57fbc8945bfdc1c/gridsight/sample_layout_70.json", "w") as f:
        json.dump(layout, f, indent=2, ensure_ascii=False)
    print("Sample layout generated at sample_layout_70.json")

if __name__ == '__main__':
    generate_70_seat_layout()
