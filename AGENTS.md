# GridSight Agent & Developer Knowledge Base (AGENTS.md)

本文件整理 GridSight 系統之開發與測試相關的指引規範。其餘資訊已移至 `docs/`，僅保留路徑指示。

---

## 📁 參考文件路徑指示
- **系統架構與功能全覽**：請參閱 [`docs/system_features_and_usage.md`](docs/system_features_and_usage.md)

## 🚀 3. 學生端 (gs-agent) 生命週期與極速連線

### 3.3 學生端交叉編譯 (`gs-agent.exe`)
> [!IMPORTANT]
> **如需使用 MinGW-w64 / mingw32 編譯，一律在 Docker 內執行**。
> 嚴禁在宿主機 (Host) 直接調用本地 mingw32 編譯器，必須透過 Docker 容器環境隔離編譯，以確保編譯工具鏈版本一致性、純淨度並杜絕環境相依污染。

- **一鍵 Docker 編譯（推薦）**：
  ```bash
  ./scripts/build-docker.sh
  ```
  > 執行後自動拉起 `Dockerfile.builder`（Ubuntu 22.04 + MinGW-w64），在容器內以 `x86_64-w64-mingw32-g++` 靜態編譯所有 `beacon/src/*.cpp`。
- **產物位置**：`beacon/gs-agent.exe`（約 3.5 MB）
- **手動 Docker 操作（進階）**：
  ```bash
  # 單次編譯（不執行 build-docker.sh 腳本時）
  docker build -t gridsight-builder:latest -f Dockerfile.builder .
  docker run --rm -v "$(pwd):/workspace" gridsight-builder:latest \
    make -C beacon clean all CXX=x86_64-w64-mingw32-g++
  ```

### 3.4 Ubuntu 原生建置與測試 (Ubuntu Native Build & Test) ⭐【V5.8 唯一正式測試路徑】
> ⚠️ **本節為 GridSight 全域唯一受支援的「編譯＋單元測試」路徑**。凡涉及 beacon 原生編譯或 beacon 單元測試，**一律**循本節（含 console 的 Ubuntu 產線）。
> 凡涉及與教師端之跨模組整合、網路通訊、多播廣播、快照推送與斷線自癒測試，**一律嚴格遵循 §12.4 雙容器獨立 Docker 測試產線**（[`docker-compose.test-cluster.yml`](docker-compose.test-cluster.yml)）。
> 已實證可跑：`docker run` 於容器內以 g++ 原生編譯出 Linux ELF `gs-agent`（5.9.0，347 KB），並通過 beacon 全部 host-side 單元測試（`test-capture/test-utils/test-input-rtp/test-viewport` 全數 PASS）。

- **Dockerfile**：`Dockerfile.ubuntu-agent`（Ubuntu 24.04 + build-essential；**不**安裝 GDI+/DXGI/X11 seam，因 beacon capture Linux 分支已是 stub seam → image 極小、headless 可跑全部 host unit tests）
- **建置 image**：
  ```bash
  docker build -t gridsight-ubuntu-agent:latest -f Dockerfile.ubuntu-agent .
  ```
- **執行「編譯 beacon + 跑全部 beacon host 測試」**：
  ```bash
  docker run --rm -v "$(pwd)":/workspace -w /workspace gridsight-ubuntu-agent:latest
  # 等價於容器內: make -C beacon CXX=g++ TARGET=gs-agent && make -C beacon test
  ```

> [!NOTE] 本節 seam 為「編譯＋測試」肇始 commit (V5.8)。先前
> test seam 多散布於 script seam，此節統一收斂；未來 beacon 產線不得跳過此 Docker seam。

---

## 🖥️ 4. 教師端 (gs-console) 建置與部署

### 4.1 Windows 獨立單檔打包 (`gs-console.exe`)
- **打包指令**：
  ```bash
  npm run build:windows
  # 或 node scripts/build-windows-console.js
  ```
- **產物位置**：`release/gs-console.exe`（約 37 MB）
- **特性**：
  - 零依賴、免裝 Node.js、免裝 Docker。
  - 啟動時自動偵測多網卡（Multi-NIC）並支援 6 秒倒數互動挑選，伺服器就緒後自動開啟預設瀏覽器導向 `http://localhost:3000`。
  - 內建包含 `dist/` 前端、`beacon/gs-agent.exe` 下載與多播探索。
  - 佈局自動儲存於同層 `data/seats.json`。

### 4.2 Windows 官方簽名綠色便攜包 (`gridsight-console-portable.zip`) ⭐【零防毒誤報推薦】
- **一鍵完整建置（推薦，自動安裝相依套件並編譯學生端代理）**：
  ```bash
  npm run build:portable:full
  # 或 ./scripts/build-portable.sh
  ```
- **手動逐步建置**：
  ```bash
  npm install --prefix console            # 前置：前端相依（缺少時 tsc 報錯）
  npm install --prefix console/server     # 前置：後端相依（缺少時 esbuild 無法解析 cors/ws）
  ./scripts/build-docker.sh               # 前置：交叉編譯 beacon/gs-agent.exe（若尚未產出）
  npm run build:portable
  # 或 node scripts/build-windows-portable.js
  ```
- **產物位置**：`release/gridsight-console-portable.zip`（約 27 MB）
- **特性**：
  - **100% 絕不觸發 Windows Defender / SmartScreen 警告**。
  - 內嵌微軟 / OpenJS 官方認證數位簽章之原生 `node.exe`。
  - 支援多網卡終端機互動挑選與自動啟動，包含 `start-console.bat`（一鍵啟動並自動開啟瀏覽器）與 `stop-console.bat`（一鍵停止）。
- **陷阱**：若 `console/node_modules` 或 `console/server/node_modules` 尚未安裝，`build:portable` 會以「tsc: not found」與「Could not resolve 'cors'/'ws'」失敗；請先執行上述前置之 npm install。

### 4.3 Linux Docker 容器部署
> ⚠️ **本 seam 為 GridSight 教師端 (gs-console) 在 Linux 下唯一受支援的「編譯＋運行」路徑**，與 3.4（beacon seam）同屬原生測試產線。凡涉及雙方跨容器網路通訊、多播廣播與自動連線測試，**一律嚴格遵循 §12.4 雙容器獨立 Docker 測試產線**（[`docker-compose.test-cluster.yml`](docker-compose.test-cluster.yml)）。
- **編譯（含 frontend tsc + esbuild + server tsc）**：
  ```bash
  docker compose build
  ```
- **啟動與重構**：
  ```bash
  docker compose build && docker compose up -d
  ```
- 容器對外僅映射 `3000:3000`，座位配置持久化掛載於 `/data/seats.json`。

---

## 🤖 8. CI/CD 發布流程 (GitHub Actions)

### 發布新版本步驟
1. 同步更新版本號至以下全部位置（`console/package.json` 是**唯一版本來源**，其餘為一致性同步或 fallback）：
   - `package.json`（根）、`console/package.json` + `console/package-lock.json`
   - `console/server/package.json` + `package-lock.json`、`console/server/server.ts`（fallback 常數）
   - `console/server/installerScript.test.ts`、`beacon/Makefile`（fallback）、`docs/protocol_spec.md`、`tools/mock_agents.py`（fallback）
   - （`scripts/build-windows-console.js` 動態讀取 `console/package.json`，無需手動改）
2. 建立 Git Tag 並推送：
   ```bash
   git tag -a v5.8.8 -m "Release v5.8.8: ..."
   git push origin v5.8.8
   ```
3. GitHub Actions (`.github/workflows/release.yml`) 會自動執行：
   - 交叉編譯產出 `gs-agent.exe`
   - 打包產出 `gs-console.exe`
   - 自動發布至 GitHub Releases 頁面供下載。

---

## ⚠️ 9. 常見陷阱與開發規範 (Developer Gotchas)

1. **嚴禁寫死 Port 3001**：
   - 任何涉及學生端連線、快照推送、WebSocket 串流、或 Docker 配置，一律使用 Port **`3000`**。
2. **剪貼簿 API 需相容 HTTP**：
   - 任何複製文字功能必須包含 `document.execCommand('copy')` 備援，以相容內網純 HTTP 存取。
3. **佈局套用不可清空 Aisles / Obstacles**：
   - 更新 `ClassroomLayout` 時，務必透過 `(layout.aisles || [])` 與 `(layout.obstacles || [])` 傳遞與保留。
4. **路徑跨平台相容性**：
   - 在 `server.ts` 中讀寫 `SEATS_FILE` 時，需判斷 `process.platform === 'win32'` 與 `process.pkg`，Windows 環境預設寫入 `./data/seats.json`，Linux/Docker 預設寫入 `/data/seats.json`。
5. **廣播畫面滑鼠特效合成管線 (In-Pipeline Compositor vs Layered Window)**：
   - **核心架構**：教師全體廣播（UDP RTP 9000）之滑鼠特效**完全不使用 Windows 透明疊加視窗**。而是透過 `tools/screen_capture.cpp`（`GridSightScreenCapture.exe`，Option A / OBS 模式），在 DXGI 抓取桌面影格後，於記憶體 32-bit BGR0 影像緩衝區內直接以 GDI+ 烙印真實游標（`GetCursorInfo` + `Bitmap::FromHICON`）、點擊擴散光波與滾輪氣泡，隨後透過 stdout 管道直推 FFmpeg `stdin` 壓縮為 H.264 串流。
   - **架構優勢**：(1) 教師桌面 100% 純淨無遮擋、無殘影與焦點干擾；(2) 特效與畫面達成 0ms 完美幀同步；(3) 教師螢幕錄影（MP4）原生自帶滑鼠特效；(4) 學生端 0% 額外疊加負擔，純解碼播放。
   - **歷史備註**：早前 v5.8.4 曾實驗使用 Win32 `UpdateLayeredWindow` + `ULW_ALPHA` 之透明分層視窗方案，但已於 v5.8.6 全面廢棄並升級為記憶體管線硬體合成架構。
6. **Linux / CI 編譯相容性**：
   - `beacon/src/utils.cpp` 中由跨平台共用函式訪問之全域/原子變數（如 `g_shutdown_cancelled`），絕不可置於 `#ifdef _WIN32` 內，以確保 Linux 原生單元測試（`make test-capture`）編譯無阻。
7. **MinGW-w64 (mingw32) 編譯規範**：
   - **如需使用 MinGW-w64 / mingw32 編譯，一律在 Docker 內執行**。嚴禁在宿主機 (Host) 直接調用本地 mingw32 編譯器，必須透過 Docker 容器隔離編譯（`./scripts/build-docker.sh` 或 `gridsight-builder`），以確保工具鏈版本一致性、避免本機相依污染與產物不穩定。

---

## 🛠️ 12. 除錯通道雙方斷線與自動復線測試規範 (Debug Channel Disconnection & Recovery)

### 12.1 架構原理與反向通道 (Reverse Channel Architecture)
- **通訊路徑**：學生端代理 (`gs-agent`) 主動出站反向連線至教師端 WebSocket（`ws://<TEACHER_IP>:3000/ws/agent?mac=...&ip=...`），徹底穿透學生機本地防火牆與 NAT 限制。
- **除錯通道與日誌抓取**：
  - 教師端呼叫 `GET /api/agent/:id/logs`（需驗證教師 PIN 授權 Token）。
  - 後端伺服器由 `agentSockets` 取得對應反向 WebSocket，發送 `{ action: "GET_LOGS" }` 指令。
  - `gs-agent` 之 `ReceiveCommands` 攔截指令後讀取日誌全文，回傳 `LOGS_REPORT` 封包。
  - 教師端接收後以 `HTTP 200 OK` (`text/plain`) 即時回應日誌內容。

### 12.2 斷線行為與狀態碼規範 (Disconnection Lifecycle & Status Codes)
1. **學生端 (`gs-agent`) 離線 / 異常終止**：
   - **緩衝期內（< 20 秒，`STALE_MS`）**：`findDevice()` 仍命中暫存，但 `agentSockets` 已由 `ws.on('close')` 清理移除。
     ➔ `GET /api/agent/:id/logs` 回應 **`HTTP 502 Bad Gateway`**（訊息：`目標學生機的反向 WebSocket 未連線`）。
   - **過期後（> 20 秒）**：設備自 `multicastDiscovery` 自動過期 unindex。
     ➔ `GET /api/agent/:id/logs` 回應 **`HTTP 404 Not Found`**（訊息：`找不到指定的學生端裝置`）。
2. **教師端 (`gs-console`) 離線 / 服務重啟**：
   - 教師端關閉 `0.0.0.0:3000` 監聽。
   - `gs-agent` `ReceiveCommands` 偵測到連線中斷，印出 `[WARN] Reverse WebSocket disconnected, retrying...`。
   - `gs-agent` 之 `ConnectOutboundLoop` 每 2 秒進行出站重連；因目標埠無 Listener，產生 **`error 111`** (`ECONNREFUSED`，實證為常態重試等待，非通訊協定或容器埠配置錯誤)。

### 12.3 自動復線實證與驗證步驟 (Verification Runbook)
嚴格循 `§3.4` (Ubuntu ELF `gs-agent`) 與 `§4.3` (Console 產線) 進行驗證：

1. **基線建立**：
   - 啟動 `gs-console` (`0.0.0.0:3000`) 與 `gs-agent`。
   - 驗證教師 PIN 登入 (`POST /api/auth/login`) 取得 Token。
   - 驗證 `GET /api/agent/:id/logs` 回傳 `HTTP 200 OK` 且日誌內容成功拉取。
2. **測試 A：學生端離線與重連恢復 (Agent Disconnect / Recovery)**：
   - 終止 `gs-agent` (`kill -15 <pid>`)。
   - 驗證 `GET /api/agent/:id/logs` 在緩衝期內回傳 `HTTP 502`、超時後回傳 `HTTP 404`。
   - 重新啟動 `gs-agent` (`TEACHER_IP=... ./beacon/gs-agent`)。
   - 驗證反向 WS 自動握手並送出 `AGENT_INFO_REGISTER`。
   - 驗證 `GET /api/agent/:id/logs` 立即回歸 **`HTTP 200 OK`**。
3. **測試 B：教師端重啟與學生端自動復線 (Console Restart / Auto-Reconnect)**：
   - 終止 `gs-console` (關閉 Port 3000)。
   - 觀察 `gs-agent` 進入重試循環，日誌明確標註 `error 111` 重連嘗試。
   - 重新啟動 `gs-console` (重啟 Port 3000)。
   - 驗證 `gs-agent` 於 2 秒內自動重連成功，完成反向 WebSocket 註冊。
   - 驗證 `GET /api/agent/:id/logs` 立即恢復 **`HTTP 200 OK`**，日誌中可直接調閱到剛才斷線與重連之歷史紀錄。

### 12.4 雙容器獨立 Docker 測試產線 (Two-Container Docker Test Cluster) ⭐【全系統唯一正式網路與編碼測試標準】
> ⚠️ **後續全系統之網路通訊、多播廣播、輸入多播、快照推送與雙向斷線復線測試，一律全面規範使用此雙容器 Docker 獨立環境**（[`docker-compose.test-cluster.yml`](docker-compose.test-cluster.yml)）。
> 嚴禁在宿主機 (Host) 混雜啟動零散背景進程，徹底杜絕網路命名空間混淆與非預期連接埠衝突。

#### 12.4.1 架構與虛擬影音採集配置
- **拓撲配置**：
  - **`gs-test-console`**（教師端容器，IP `172.28.0.10`）：
    - 運行 `gridsight-console:latest`（Node.js 20 Alpine + FFmpeg + iproute2 + curl）。
    - 支援 `USE_TEST_SOURCE=true`：免實體顯卡與音效卡，FFmpeg 動態產生 `lavfi testsrc2` 30 FPS 畫面與 `sine` 1000Hz 音訊訊號，直接推流至 RTP 多播 `239.255.42.100:9000`。
  - **`gs-test-agent`**（學生端容器，IP `172.28.0.20`，靜態 MAC `02:42:ac:1c:00:14`）：
    - 運行 `gridsight-ubuntu-agent:latest`（Ubuntu 24.04 + build-essential + iproute2 + curl）。
    - 支援 Linux 軟體圖樣產生與 `stb_image_write` 真實 JPEG 壓縮，以 1 FPS 自動推送至教師端 `/api/agent/snapshot`。
    - 支援動態接收 Discovery 多播 (`239.255.42.99:8888`)、Video RTP 多播 (`239.255.42.100:9000`) 與 Input RTP 多播 (`239.255.42.100:9002`)。
  - **隔離網路 (`gridsight-testnet`)**：
    - Docker Bridge 子網 `172.28.0.0/16`。
    - 雙方容器具備 `NET_ADMIN` 能力，於 entrypoint 自動執行 `ip route add 224.0.0.0/4 dev eth0`，確保多播與 IGMP 封包跨容器轉發穿透。

#### 12.4.2 一鍵測試與自動復線驗證指令
1. **啟動測試叢集**：
   ```bash
   docker compose -f docker-compose.test-cluster.yml up -d
   ```
2. **驗證基線 (在線、快照、反向 WS 日誌拉取、全班多播廣播)**：
   ```bash
   # 1. 教師登入取得 Token
   TOKEN=$(curl -s http://172.28.0.10:3000/api/auth/login -H "Content-Type: application/json" -d '{"pin":"888888"}' | jq -r .token)

   # 2. 驗證裝置在線
   curl -s http://172.28.0.10:3000/api/devices -H "Authorization: Bearer $TOKEN"

   # 3. 驗證真實 JPEG 縮圖推送 (stb_image_write)
   curl -s -X POST http://172.28.0.10:3000/api/snapshots/batch \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"requests":[{"id":"02:42:ac:1c:00:14","since":0}]}'

   # 4. 驗證除錯通道反向 WebSocket 拉取日誌
   curl -s -i "http://172.28.0.10:3000/api/agent/02:42:ac:1c:00:14/logs" -H "Authorization: Bearer $TOKEN"

   # 5. 驗證合成 30 FPS 畫面多播推流與學生端接收
   curl -s -X POST http://172.28.0.10:3000/api/broadcast/start -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"quality":"low","fps":15}'
   docker logs --tail 10 gs-test-agent   # 觀察 RTP FU-A 重組與 Input RTP 接收
   curl -s -X POST http://172.28.0.10:3000/api/broadcast/stop -H "Authorization: Bearer $TOKEN"
   ```
3. **驗證斷線與自動復線測試**：
   - **測試 A（停用 Agent 容器）**：
     `docker compose -f docker-compose.test-cluster.yml stop test-agent` ➔ 驗證 `GET /api/agent/:id/logs` 回傳 502 ➔ `docker compose -f docker-compose.test-cluster.yml start test-agent` ➔ 驗證 3 秒內自動恢復 200 OK。
   - **測試 B（停用 Console 容器）**：
     `docker compose -f docker-compose.test-cluster.yml stop test-console` ➔ 觀察 Agent 日誌記錄 `error 111` 重連嘗試 ➔ `docker compose -f docker-compose.test-cluster.yml start test-console` ➔ 驗證 Agent 自動重新握手連線，`GET /api/agent/:id/logs` 恢復 200 OK。
4. **驗證動態點名與學號簽到測試**：
   ```bash
   python3 tools/test_rollcall_cluster.py
   # 全程自動化驗證：WS 點名下發 ➔ 學生自動回應學號 ➔ 後端名冊更新 ➔ 單獨重填 ➔ CSV 匯出 ➔ 結束點名
   ```
5. **驗證分享網址與分享檔案測試**：
   ```bash
   python3 tools/test_share_cluster.py
   # 全程自動化驗證：全班/定向分享網址 ➔ 學生日誌校驗 ➔ 檔案上傳 ➔ 學生下載 ➔ 雜湊與位元組完全一致校驗 ➔ 安全路徑防禦
   ```
6. **驗證課堂作業批次收取測試**：
   ```bash
   python3 tools/test_assignment_cluster.py
   # 全程自動化驗證：發起作業收取 ➔ 學生繳交 ➔ 重複覆蓋最新版 ➔ 格式限制防禦 ➔ 全班零依賴 ZIP 打包下載與解壓縮位元組校驗 ➔ 結束收取
   ```
7. **驗證教師與學生螢幕錄影測試**：
   ```bash
   python3 tools/test_recording_cluster.py
   # 全程自動化驗證：音訊裝置列舉 ➔ 教師獨立錄影 ➔ 廣播同步雙軌錄影 ➔ 學生 H.264 焦點串流原生錄製 ➔ 錄影清單與下載 ➔ 路徑穿越防禦 ➔ 刪除錄影
   ```
8. **測試完成拆除叢集**：
   ```bash
   docker compose -f docker-compose.test-cluster.yml down
   ```

---

## ⏱️ 14. 廣播延遲與網路抖動基準測試 (Broadcast Latency & Jitter Benchmarking)

### 14.1 Docker 環境下的延遲測試能力與邊界
- **可精準測量（軟體與管線層）**：
  1. **示範轉播中繼轉發延遲 (Showcase Relay Forwarding Latency)**：
     - 測試路徑：模擬學生 WebSocket 推送 NALU ➔ 教師端 Console 接收 ➔ 直推 FFmpeg stdin (`-c:v copy`) ➔ UDP RTP 多播輸出 (`239.255.42.100:9000`) ➔ 接收端 Socket 收包。
     - 精準度：因為發送端與接收端共享 Linux 核心高精度時鐘 (`CLOCK_MONOTONIC`)，可達到微秒級無時鐘差測量。
     - **基準實測值**：平均約 **1.2 ~ 1.5 ms**（證明 Node.js + FFmpeg 零拷貝轉發開銷極低）。
  2. **RFC 3550 RTP 封包抖動 (Interarrival Jitter)**：
     - 解析 RTP 標頭 32-bit Timestamp（90kHz 視訊時脈）與抵達時間，計算標準抖動值與影格間距。
- **需真實 Windows 機台驗證（硬體層）**：
  - 教師端 DXGI Desktop Duplication 顯存截圖耗時（~1-5ms）。
  - 學生端 Media Foundation MFT 硬體解碼與實體顯示器 V-Sync 渲染延遲（~10-25ms）。

### 14.2 一鍵基準測試工具 (`scripts/benchmark-broadcast-latency.py`)
```bash
# 對本地或 Docker 測試叢集發起全自動廣播延遲壓測
python3 scripts/benchmark-broadcast-latency.py http://172.28.0.10:3000
# 或本機執行：
python3 scripts/benchmark-broadcast-latency.py http://127.0.0.1:3000
```
- 工具會依序執行「Part 1 教師廣播抖動與影格節奏分析」與「Part 2 示範轉播微秒級中繼轉發延遲採樣」，並輸出 Min / Median / Avg / P95 / Max 延遲報告。
