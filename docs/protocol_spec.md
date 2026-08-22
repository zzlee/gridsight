# GridSight 通訊協定與網路架構規範 (Protocol Specification)

本文檔完整且精確地定義 GridSight Console (教師端控制台) 與 GridSight Beacon (`gs-agent.exe` 學生端代理程式) 之間的所有通訊協定規範、網路傳輸方向、連接埠矩陣、訊息格式與系統限制。

---

## 📌 1. 網路協定與連接埠矩陣 (Protocol & Port Matrix)

| 協定 / 服務 | 連接埠 / 多播位址 | 發起方 (Initiator) | 接收方 (Listener) | 連線方向 | 目的與說明 | 防火牆與網路配置要求 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **UDP Multicast Beacon** | `239.255.42.99:8888` / `9001` | 學生端 (Agent) | 教師端 (Console) | 學生 ➔ 教師 (Multicast) | 學生端啟動時廣播心跳、硬體資訊及焦點視窗標題 | 需允許 UDP 239.255.42.99 入站/出站及網卡多播轉發 |
| **UDP Unicast Token Grant** | 動態 UDP 連接埠 (回傳 Port) | 教師端 (Console) | 學生端 (Agent) | 教師 ➔ 學生 (Unicast Response) | 教師端授予學生端 Session Token 與 Teacher IP | 需允許 UDP 單播回應 |
| **HTTP Snapshot Push** | `TCP 3000` (`POST /api/agent/snapshot`) | 學生端 (Agent) | 教師端 (Console) | 學生 ➔ 教師 (Outbound HTTP) | 學生端每秒主動推送 480×270 JPEG 縮圖至教師端快取 | 學生端出站 TCP 3000，無需開啟學生端入站防護 |
| **HTTP Snapshot Fetch** | `TCP 3000` (`GET /api/snapshot/:id`) | 前端瀏覽器 | 教師端 (Console) | 瀏覽器 ➔ 教師 (HTTP GET) | 前端監控面板向教師端後端讀取快取之最新學生縮圖 | 教師端 TCP 3000 入站允許 |
| **Reverse WebSocket Relay** | `TCP 3000` (`/ws/agent?mac=...&ip=...&token=...`) | 學生端 (Agent) | 教師端 (Console) | 學生 ➔ 教師 (Outbound WS) | 學生端主動向教師端建立反向持久 WS 連線，接收控制指令與傳輸 H.264 串流 | 學生端出站 TCP 3000，可穿越一般客戶端防火牆 |
| **Teacher Viewer WS** | `TCP 3000` (`/ws/stream/:target`) | 前端瀏覽器 | 教師端 (Console) | 瀏覽器 ➔ 教師 (WS GET) | 前端 30 FPS 焦點調閱播放器連接教師端中繼以接收 H.264 串流 | 教師端 TCP 3000 入站允許 |
| **Direct WebSocket Fallback** | `TCP 8081` (`ws://<STUDENT_IP>:8081/stream`) | 前端 / 測試工具 | 學生端 (Agent) | 客戶端 ➔ 學生 (Direct WS) | 學生端本地直接 WebSocket 串流監聽端點（備援路徑） | 需開啟學生端 TCP 8081 入站防火牆 |
| **Local HTTP Agent API** | `TCP 8080` (`/snapshot`, `/status`, `/ping`) | 教師端 / 測試工具 | 學生端 (Agent) | 教師 ➔ 學生 (HTTP GET) | 學生端本地 HTTP 伺服器，支援高清對照縮圖調閱及健康檢查 | 需開啟學生端 TCP 8080 入站防火牆 |
| **RTP Multicast Broadcast** | `239.255.42.100:9000` | 教師端 (FFmpeg/Console) | 學生端 (Agent) | 教師 ➔ 學生 (UDP Multicast) | 教師畫面 1080p 30FPS H.264 廣播串流 | 交換器需開啟 IGMP Snooping 轉發多播封包 |

---

## 📊 2. 系統架構與通訊流程圖 (Mermaid Diagrams)

### 2.1 設備探索與動態 Token 鑑權流程 (Discovery & Token Grant)

```mermaid
sequenceDiagram
    autonumber
    participant Student as 學生端 (gs-agent)
    participant Teacher as 教師端 (gs-console:3000)

    Student->>Teacher: UDP Multicast (239.255.42.99:8888/9001)<br/>JSON Payload: Beacon Info, Specs, Active Window
    Note over Teacher: 記錄學生機 MAC/IP/Specs<br/>生成動態 Session Token
    Teacher-->>Student: UDP Unicast Response<br/>JSON Payload: TOKEN_GRANT (token, teacherIp, sessionDurationSec)
    Note over Student: 學生端保存 Token 於 RAM<br/>設定 Teacher IP 供出站推流使用
```

### 2.2 常態監控縮圖推拉流程 (Snapshot Push, Cache & Fetch)

```mermaid
sequenceDiagram
    autonumber
    participant Student as 學生端 (gs-agent)
    participant Teacher as 教師端 Server (3000)
    participant Browser as 教師端 Web UI (Browser)

    loop 每秒 1 FPS 定時推流
        Student->>Teacher: HTTP POST /api/agent/snapshot<br/>Headers: X-Agent-MAC, X-Agent-IP, X-Active-Window (base64)<br/>Body: 480x270 JPEG 二進位資料
        Note over Teacher: 更新 snapshotCache (Memory Map)<br/>與學生 activeWindow 狀態
        Teacher-->>Student: HTTP 200 OK {"status":"ok"}
    end

    loop 前端 1 FPS Polling (經 CircuitBreaker 熔斷器)
        Browser->>Teacher: HTTP GET /api/snapshot/:id
        alt 快取存在且非過期 (< 3s)
            Teacher-->>Browser: HTTP 200 OK (image/jpeg)
        else 快取過期或不存在
            Teacher->>Student: HTTP GET http://<STUDENT_IP>:8080/snapshot (Fallback Proxy)
            Student-->>Teacher: HTTP 200 OK (image/jpeg)
            Teacher-->>Browser: HTTP 200 OK (image/jpeg)
        end
    end
```

### 2.3 焦點 30 FPS 實時串流雙向中繼流程 (Focus Streaming Flow)

```mermaid
sequenceDiagram
    autonumber
    participant Student as 學生端 (gs-agent)
    participant Server as 教師端 Server Relay (3000)
    participant Browser as 前端 WebCodecs Player

    Note over Student,Server: 啟動後建立反向持久 WebSocket 連線
    Student->>Server: GET /ws/agent?mac=<MAC>&ip=<IP>&token=<TOKEN> (HTTP Upgrade)
    Server-->>Student: 101 Switching Protocols
    Note over Server: agentSockets.set(MAC, ws)

    Browser->>Server: GET /ws/stream/<TARGET_MAC> (HTTP Upgrade)
    Server-->>Browser: 101 Switching Protocols
    Note over Server: viewerSockets.get(MAC).add(ws)

    Server->>Student: WS Text: {"action":"START_STREAM","fps":30,"bitrate":2500}
    Note over Student: 啟動 DXGI 擷取與 MFT H.264 30 FPS 硬體編碼器

    loop 30 FPS 串流傳輸
        Student->>Server: WS Binary Frame (H.264 NALU Annex B Format)
        Server->>Browser: WS Binary Frame (轉發至對應 Viewer)
        Note over Browser: WebCodecs VideoDecoder 解碼並繪製至 Canvas
    end

    Browser->>Server: WS Close / 離開焦點視窗
    Server->>Student: WS Text: {"action":"STOP_STREAM"}
    Note over Student: 暫停 30 FPS 編碼器，節省 CPU/GPU 資源
```

### 2.4 教師全體廣播串流流程 (Classroom Broadcast Flow)

```mermaid
sequenceDiagram
    autonumber
    participant Teacher as 教師端 (FFmpeg Streamer)
    participant Switch as L2/L3 交換器 (IGMP Snooping)
    participant Student as 學生端 (RTPReceiver)

    Note over Student: 啟動即加入 IGMP Multicast 權限群組
    Student->>Switch: IGMP Join (239.255.42.100)

    Teacher->>Switch: UDP Multicast Push (239.255.42.100:9000)<br/>RTP Payload: H.264 (FU-A Packets RFC 6184)
    Switch->>Student: 多播組件硬體複製轉發包

    Note over Student: RTPReceiver 接收 UDP 封包<br/>重組 FU-A 分片為完整 NALU
    Note over Student: 自動彈出 Win32 滿版置頂視窗<br/>(支援雙擊 / F11 切換全螢幕)
```

---

## 📄 3. 詳細 API 規格與資料格式 (Endpoints & Payloads)

### 3.1 學生端宣告 (Beacon Announcement)
- **傳輸方式**：UDP Multicast (`239.255.42.99:8888` 或 `9001`)
- **發送頻率**：啟動時發送，隨後 3~5 秒隨機抖動週期發送。
- **Payload 格式 (JSON)**：
```json
{
  "type": "BEACON",
  "version": "5.4.3",
  "hostname": "PC-01",
  "ip": "192.168.1.101",
  "mac": "00:1A:2B:3C:4D:01",
  "username": "Student01",
  "timestamp": 1723812345678,
  "active_window": "Visual Studio Code - main.cpp",
  "specs": {
    "agent_version": "5.4.3",
    "os": "Windows 11 Pro 64-bit",
    "uptime": 3600,
    "cpu": {
      "model": "12th Gen Intel(R) Core(TM) i7-12700",
      "cores": 12,
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

### 3.2 Token 授權回應 (Token Grant)
- **傳輸方式**：UDP Unicast (回應至學生發送端點)
- **Payload 格式 (JSON)**：
```json
{
  "type": "TOKEN_GRANT",
  "token": "d8a1f8c4e2b094817a3f89e210cd4e5f",
  "teacherIp": "192.168.1.200",
  "sessionDurationSec": 10800
}
```

### 3.3 學生端推送縮圖 (`POST /api/agent/snapshot`)
- **目標端點**：`http://<TEACHER_IP>:3000/api/agent/snapshot`
- **Headers**：
  - `X-Agent-MAC`: `00:1A:2B:3C:4D:01`
  - `X-Agent-IP`: `192.168.1.101`
  - `X-Active-Window`: Base64 編碼之當前視窗標題（例如：`VmlzdWFsIFN0dWRpbyBDb2Rl`）
  - `Content-Type`: `image/jpeg`
- **Body**：480×270 JPEG 影像二進位數據 (Quality 70)
- **回應**：`200 OK` `{"status":"ok"}`

### 3.4 前端讀取快取縮圖 (`GET /api/snapshot/:id`)
- **請求端點**：`http://<TEACHER_IP>:3000/api/snapshot/00:1A:2B:3C:4D:01` 或 `/api/snapshot/192.168.1.101`
- **回應標頭**：
  - `Content-Type`: `image/jpeg`
  - `Cache-Control`: `no-cache, no-store, must-revalidate`
- **錯誤處理**：若記憶體無快取且嘗試 Agent Proxy 也失敗，回傳 `404 Not Found` `{"error":"No snapshot available"}`

### 3.5 學生端反向 WebSocket (`/ws/agent`)
- **端點**：`ws://<TEACHER_IP>:3000/ws/agent?mac=<MAC>&ip=<IP>&token=<TOKEN>`
- **方向**：學生端 ➔ 教師端 (Outbound WS)
- **訊息類型**：
  - **二進位訊息 (Binary)**：H.264 NAL Unit (帶 `0x00000001` 起始碼之 Annex B 格式)。
  - **控制控制指令 (Text JSON From Teacher)**：
    - `{"action": "START_STREAM", "fps": 30, "bitrate": 2500}`
    - `{"action": "STOP_STREAM"}`
    - `{"action": "OPEN_URL", "url": "https://example.com"}`
    - `{"action": "SHARE_FILE", "url": "http://.../download/...", "filename": "lesson1.pdf"}`

### 3.6 學生端本地 HTTP API (Port 8080)
- **`GET /snapshot`**：
  - 支持 Query 參數 `full=1` 或 `highres=1`。若指定高解析度，則即時擷取 1:1 螢幕解析度並編碼 JPEG (Quality 85) 回傳；否則回傳本地快取之 480×270 縮圖。
  - 支持 `X-Auth-Token` Header 鑑權。
- **`GET /status`**：
  - 回傳學生端硬體遙測數據 (JSON 格式)。
- **`GET /ping`**：
  - 回傳 `{"status":"ok","service":"GridSight Beacon"}` 用於探針檢測。

---

## ⚠️ 4. 現有實作限制與 TODOs (Implementation Limitations)

1. **RTP 廣播渲染管線 (RTPReceiver Frame Rendering)**：
   - 目前 `beacon/src/rtp_receiver.cpp` 已完整實作 **UDP Socket 監聽**、**IGMP 權限加入 (`IP_ADD_MEMBERSHIP`)**、**RTP Header 解析**、**RFC 6184 FU-A NALU 重組** 及 **Win32 滿版 overlay 彈窗**。
   - 然而，`RTPReceiver::RenderFrame(const uint8_t* h264_data, size_t size)` 目前仍為**空函式 Stub (TODO)**。實際將重組後之 H.264 NALU 送入 Windows DirectShow / MFT / D3D11 進行軟硬體解碼繪製至 overlay 視窗之邏輯尚待完成。

2. **多網卡宣告與環境適應**：
   - 學生端預設以主要網卡 `Utils::GetSystemNetworkInfo()` 回傳 IP 進行廣播。若學生機具備虛擬網卡 (如 Docker, VMware)，需確保優先選用真實物理 LAN 網卡。

3. **直接 WebSocket 備援連線**：
   - `ws://<STUDENT_IP>:8081/stream` 需學生端防火牆放行 TCP 8081 入站。預設運作時優先使用出站反向連線 `/ws/agent`。
