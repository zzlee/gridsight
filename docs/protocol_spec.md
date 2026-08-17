# GridSight 通訊協定與 API 規範 (Protocol Specification)

本文檔定義 GridSight Console (教師端) 與 GridSight Beacon (`gs-agent.exe` 學生端) 之間的所有通訊協定規範。

---

## 1. 設備探索與動態 Token 鑑權協定

### 1.1 學生端上線宣告 (Beacon Announcement)
- **傳輸方式**：UDP Multicast
- **組播地址**：`239.255.42.99:9001`
- **發送時機**：`gs-agent.exe` 啟動時立即發送，隨後以 3~5 秒隨機抖動 (Jitter) 週期發送。
- **Payload 格式 (JSON)**：
```json
{
  "type": "BEACON",
  "version": "5.3.0",
  "hostname": "PC-01",
  "ip": "192.168.1.101",
  "mac": "00:1A:2B:3C:4D:01",
  "username": "Student01",
  "timestamp": 1723812345678,
  "specs": {
    "agent_version": "5.3.0",
    "os": "Windows 11",
    "uptime": 3600,
    "cpu": {
      "model": "Intel Core i7",
      "cores": 8,
      "usage_percent": 15.5
    },
    "ram": {
      "total_mb": 16384,
      "avail_mb": 8192,
      "usage_percent": 50.0
    },
    "disk": {
      "drive": "C:\\",
      "total_gb": 512,
      "free_gb": 256,
      "usage_percent": 50.0
    }
  }
}
```

### 1.2 教師端 Token 授權回應 (Token Grant)
- **傳輸方式**：UDP Unicast (直接回傳至學生端發送端口)
- **Payload 格式 (JSON)**：
```json
{
  "type": "TOKEN_GRANT",
  "token": "d8a1f8c4e2b094817a3f89e210cd4e5f",
  "teacherIp": "192.168.1.200",
  "sessionDurationSec": 10800
}
```
*學生端將此 Token 保存於記憶體 RAM 中（不寫入硬碟），後續所有 HTTP/WS 請求皆嚴格校驗此 Token。*

---

## 2. 模式 1：常態監控縮圖 HTTP API (Push & Fetch)

常態監控縮圖採用學生端主動推送 (Push) 與前端抓取 (Fetch) 兩段式架構，確保能穿越防火牆且教師端無需直連所有學生端。

### 2.1 學生端推送縮圖至教師端 (Agent Push)
- **傳輸協定**：HTTP/1.1 POST
- **目標端點**：教師端伺服器 (IP 來自 Token Grant)
- **API 路徑**：`POST /api/agent/snapshot`
- **預設端口**：3000
- **發送頻率**：約 1 FPS
- **請求標頭 (Headers)**：
  - `X-Agent-MAC`: `<STUDENT_MAC_ADDRESS>`
  - `X-Agent-IP`: `<STUDENT_IP_ADDRESS>`
  - `Content-Type`: `image/jpeg`
  - `Content-Length`: `<BYTES>`
- **Payload**：JPEG 影像二進位資料
  - **影像規格**：480×270 解析度，JPEG Quality 75

### 2.2 前端網頁抓取快取縮圖 (Frontend Fetch)
- **傳輸協定**：HTTP/1.1 GET
- **API 路徑**：`GET /api/snapshot/:id` (id 可為 MAC 地址或 IP 地址，允許忽略冒號等分隔符)
- **請求對象**：教師端後端伺服器
- **回應內容**：
  - **狀態碼**：`200 OK`
  - **Content-Type**：`image/jpeg`
  - **Payload**：快取在記憶體中的最新縮圖
- **錯誤回應**：
  - `404 Not Found`：無此學生的快取縮圖

---

## 3. 模式 2：焦點 30 FPS 實時串流 WebSocket 協定

### `ws://<STUDENT_IP>:8081/stream`
- **傳輸協定**：WebSocket (Binary Protocol)
- **鑑權機制**：WebSocket Handshake Query Parameter `?token=<SESSION_TOKEN>` 或 Header `X-Auth-Token`
- **封包結構 (Binary)**：
  - 每個 WebSocket Binary Message 為一個完整的 H.264 NAL Unit (Annex B 格式，帶 `0x00000001` 起始碼)。
  - 第一個封包固定為 SPS / PPS 參數集，隨後每 30 幀發送一次 IDR 關鍵幀。
- **解碼端**：前端使用瀏覽器原生 `WebCodecs` API (`VideoDecoder`) 進行 GPU 硬體解碼。

---

## 4. 模式 3：教師全體廣播 UDP Multicast RTP 協定

### `rtp://239.255.42.100:9000`
- **傳輸協定**：RTP over UDP (RFC 3551 / RFC 6184)
- **組播地址**：`239.255.42.100`
- **端口**：`9000`
- **Payload 類型**：H.264 (Dynamic PT 96)
- **封裝規格**：
  - 單包最大傳輸單元 (MTU)：1316 bytes (適配 Ethernet MTU 1500)
  - 分片封裝：FU-A (Fragmentation Unit A)
- **交換器要求**：局域網交換器需開啟 **IGMP Snooping**，確保組播封包僅複製轉發給訂閱的學生端口。
