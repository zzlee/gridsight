# GridSight Agent & Developer Knowledge Base (AGENTS.md)

本文件整理 GridSight 系統之架構設計、通訊規範、維運指令、常見陷阱與歷史決策，供後續維護、協作開發及 AI Agent 快速掌握核心邏輯。

---

## 📌 1. 系統架構與專案全覽 (Architecture Overview)

GridSight 專為具備還原卡之 Windows 電腦教室打造，兼顧極簡部署、低頻寬常態監看、30 FPS 焦點調閱與全體廣播。

### 模組架構
- **`beacon/`（學生端代理 - `gs-agent.exe`）**：
  - Windows x64 原生 C++ 撰寫，MinGW-w64 靜態編譯（無依賴、`-mwindows` 背景無痕執行）。
  - 支援 DXGI 螢幕擷取、Media Foundation H.264 硬體編碼（軟體降級）、原生 HTTP Snapshot 伺服器、WebSocket 串流推送、UDP RTP 多播接收。
- **`console/`（教師端管理介面 - `gs-console`）**：
  - 前端：React 18 + Vite + TailwindCSS（支援座位拖曳排版、走道/講台設定、WebCodecs GPU 硬體解碼播放器）。
  - 後端：Node.js Express + WebSocket Relay + UDP 多播探索服務（Port 3000）。
  - 獨立單檔版：`release/gs-console.exe`（內建 Node.js 執行期環境與 Web 靜態資源，雙擊即啟動）。
- **`tools/`（測試、特效與除錯工具）**：
  - `mock_agents.py`：支援一鍵模擬多台學生機在線註冊、虛擬螢幕縮圖與離題警示測試。
  - `ubuntu_agent_debugger.py`：支援 Ubuntu Linux 環境下即時多播解碼播放視窗（`ffplay`）與全彩即時事件除錯。
  - `mouse_overlay.cpp`（編譯為 `bin/GridSightMouseOverlay.exe`）：Windows 原生獨立滑鼠特效模組（32-bit ARGB True Alpha 逐像素透明混合、GDI+ 真實游標圖示、左右鍵與滾輪微光波紋動畫）。

---

## ⚡ 2. 網路通訊協定與連接埠規範 (Critical Port Conventions)

> [!IMPORTANT]
> **全系統標準通訊連接埠統一為 `3000`**。
> 絕不可在程式碼或文件中混用或寫死 `3001`（`3001` 為早期本機前後端分離開發之歷史殘留）。

| 協定 / 服務 | 埠號 / 組播位址 | 說明 |
| :--- | :--- | :--- |
| **教師端 Web & API** | **`TCP 3000`** | 託管 Web UI、REST API（`/api/...`）、WebSocket 中繼（`/ws/...`）與腳本下載 |
| **教師端多播探索 (Discovery)** | **`UDP 239.255.42.99:8888`** | 教師端定期廣播「教師在線」封包（含 Teacher IP 與共用 session token），學生端監聽此多播後建立單一出站反向 WebSocket；方向為教師 ➔ 學生 |
| **教師畫面全班廣播 (RTP)** | **`UDP 239.255.42.100:9000`** | 教師螢幕 H.264 廣播，支援三檔品質（高 1080p30/8M、中 720p30/4M、低 480p15/1.5M；交換器 IGMP Snooping 硬體複製） |
| **教師滑鼠與輸入多播 (Input RTP)** | **`UDP 239.255.42.100:9002`** | 教師即時滑鼠座標 (0..65535) 與點擊事件，供學生端視窗滑鼠自動跟隨與動畫特效（交換器 IGMP Snooping 硬體複製） |
| **學生端本地 Snapshot** | **不開埠 (僅出站推送)** | 學生端主動向教師端 `POST /api/agent/snapshot` 推送縮圖 |
| **教師端批次快照與差量輪詢** | **`POST /api/snapshots/batch`** | 前端單次 HTTP 聚合請求多台可見縮圖，支援 `since` 時間戳差量比對（靜態畫面 0 載荷） |

---

## 🚀 3. 學生端 (gs-agent) 生命週期與極速連線

### 3.1 學生端 1 秒極速加入 (`/join`)
學生端無需手動輸入長指令，流程如下：
1. 學生在瀏覽器開啟 **`http://<教師IP>:3000/join`**。
2. 點擊 **【📋 點此一鍵複製 Win + R 執行指令】**。
3. 鍵盤按下 **`Win + R` ➔ `Ctrl + V` ➔ `Enter`** 即可在背景無痕啟動。

```powershell
# Win + R 執行指令內容（背景執行且無彈窗）
powershell -WindowStyle Hidden -c "irm http://<教師IP>:3000/install-agent.ps1|iex"
```

> [!TIP]
> **剪貼簿 HTTP 相容性**：
> 在純 HTTP IP 環境下，瀏覽器會禁用 `navigator.clipboard`。系統已實作隱藏 `textarea` + `document.execCommand('copy')` 備援機制，保證 100% 複製成功。

### 3.2 學生端停止方式 (Stop Agent)
若需終止學生端背景行程，可使用以下任一方式：
- **遠端一鍵腳本**：`irm http://<教師IP>:3000/stop-agent.ps1 | iex`
- **PowerShell 指令**：`Stop-Process -Name "gs-agent" -Force`
- **CMD 指令**：`taskkill /f /im gs-agent.exe`
- **工作管理員**：在「詳細資料」中對 `gs-agent.exe` 點選「結束工作」。

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
> 已實證可跑：`docker run` 於容器內以 g++ 原生編譯出 Linux ELF `gs-agent`（5.8.12，347 KB），並通過 beacon 全部 host-side 單元測試（`test-capture/test-utils/test-input-rtp/test-viewport` 全數 PASS）。

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

## 🎨 5. 畫布佈局、走道與障礙物管理 (Grid Canvas & Layout)

### 5.1 矩陣維度定義
- 總行數 `layout.cols`（橫向直欄數，X）。
- 總列數 `layout.rows`（縱向橫列數，Y）。
- **注意**：`layout.rows` 為**真實實際列數**（例如 10 排即為 10，不額外減 1）。

### 5.2 走道劃分 (`layout.aisles`)
- 結構：`{ id: string, type: 'vertical' | 'horizontal', index: number, name?: string }`
- 畫布座標透過 `getVisualX` / `getVisualY` 轉換，遇到走道自動增加間距（`aisleGap = 36px`）並繪製虛線路徑標記。

### 5.3 講台與障礙物 (`layout.obstacles`)
- 支援類型：`podium` (講台 2×1/3×1)、`blackboard` (黑板 4×1)、`pillar` (立柱 1×1)、`door` (門 1×1)。
- 支援在「佈局編輯」模式下點擊右上角按鈕編輯座標、寬高跨度或刪除。

### 5.4 佈局安全持久化準則
- 當使用者在 `MatrixConfigModal` 中**修改教室名稱**或**調整矩陣尺寸**時：
  - **必須完整保留既有走道 (`layout.aisles`) 與障礙物 (`layout.obstacles`)**。
  - 僅清理超出新網格尺寸外的物件（Auto-bounds validation）。

### 5.5 批次操作 (Multi-Selection & Batch Edit)
- 支援滑鼠拉框框選 (Marquee Selection)、Ctrl / Shift 多選。
- 支援懸浮操作列（一鍵批次改名、自動重新編號、批次退回設備池）。

---

## 🔍 6. 焦點監控、流量統計與除錯開關 (Focus Viewer & HUD)

- **流量即時監測 (Traffic HUD)**：頂部導航列即時動態合併「常態 1 FPS 縮圖輪詢流量」與「全螢幕廣播 RTP 多播流量」（高 8M / 中 4M / 低 1.5M），廣播時切換為紫色狀態燈並標註 `廣播`。
- **截圖功能**：WebCodecs Player 透過 `captureSnapshot()` 將當前 GPU 渲染 Canvas 匯出為高畫質圖片（`GridSight_[seatNo]_[timestamp].jpg/.png`）。`FocusModal` 頂部提供 **JPEG / PNG** 切換（預設 JPEG Q85）並於下載後以 toast 顯示檔案大小。
- **全螢幕**：支援標準 HTML5 Fullscreen API 進行純淨無黑邊沉浸式監看。
- **HUD 預設狀態**：
  - 串流品質診斷 HUD（FPS、解碼延遲、幀類型）：**預設關閉**（點擊頂部活動圖示 📈 開啟）。
  - 硬體遙測狀態 HUD（CPU、RAM、Disk）：**預設關閉**（點擊頂部資訊圖示 ℹ️ 開啟）。

---

## 🚨 7. 學生端使用中視窗監控與離題警示 (Active Window & Off-Task Alert System)

### 7.1 視窗標題擷取與回傳
- **學生端 (`gs-agent.exe`)**：
  - 呼叫原生 Windows API `GetForegroundWindow()` 與 `GetWindowTextW()` 取得學生當前焦點應用程式視窗標題（如 `Visual Studio Code`、`YouTube - Google Chrome`）。
  - 連上教師端反向 WebSocket 後以 `AGENT_INFO_REGISTER` 上報初始值，並隨每秒 HTTP 快照請求標頭（`X-Active-Window: base64`）持續同步上報。
- **模擬器 (`mock_agents.py`)**：內建包含日常編程與離題測試程式樣本。

### 7.2 離題關鍵字庫與警示機制
- **預設關鍵字庫**：`YouTube`, `Bilibili`, `Roblox`, `Minecraft`, `Steam`, `Discord`, `Twitch`, `抖音`, `Tiktok`, `巴哈姆特`, `動畫瘋`, `Facebook`, `Instagram`, `Netflix`, `Game`, `遊戲`。
- **持久化**：關鍵字庫已全面持久化儲存於後端伺服器的 `data/seats.json`（`layout.offTaskKeywords`），任何裝置開啟教師端皆能同步同一套自訂字庫。
- **即時視覺回饋**：
  - 當學生視窗標題命中關鍵字時，座位卡片外框呈現**紅色警示脈衝光暈**（`ring-2 ring-rose-500/70 shadow-rose-950 animate-pulse`）並標註 `⚠️ 離題`。
  - 頂部導航列顯示即時「**🚨 離題警示 (N台)**」按鈕。
  - 支援一鍵開啟「**違規名單管理 / 畫布僅篩選離題學生**」，讓教師快速定位不專心學生。

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
5. **Win32 穿透視窗與 True Alpha 繪製**：
   - 滑鼠特效視窗必須使用 `UpdateLayeredWindow` 搭配 `ULW_ALPHA` 與 32-bit ARGB DIB 畫布。嚴禁使用 `SetLayeredWindowAttributes(LWA_COLORKEY)`，因其抗鋸齒半透明像素會退化為黑邊殘影。
   - 游標圖示需透過 GDI+ `Bitmap::FromHICON` 繪製以完整填充 Alpha 通道（傳統 GDI `DrawIconEx` 會將 Alpha 寫為 0 導致游標在 DWM 下隱形）。
6. **Linux / CI 編譯相容性**：
   - `beacon/src/utils.cpp` 中由跨平台共用函式訪問之全域/原子變數（如 `g_shutdown_cancelled`），絕不可置於 `#ifdef _WIN32` 內，以確保 Linux 原生單元測試（`make test-capture`）編譯無阻。
7. **MinGW-w64 (mingw32) 編譯規範**：
   - **如需使用 MinGW-w64 / mingw32 編譯，一律在 Docker 內執行**。嚴禁在宿主機 (Host) 直接調用本地 mingw32 編譯器，必須透過 Docker 容器隔離編譯（`./scripts/build-docker.sh` 或 `gridsight-builder`），以確保工具鏈版本一致性、避免本機相依污染與產物不穩定。

---

## 🔒 10. 學生螢幕黑屏鎖定與示範轉播 (Screen Lock & Showcase Relay)

### 10.1 螢幕黑屏與鍵鼠鎖定 (Feature 1)
- **視覺呈現 (1-A)**：Slate-950（`#0B1120`）深藍全螢幕置頂視窗（`WS_EX_TOPMOST | WS_EX_TOOLWINDOW`），中央 GDI 繪製金色大鎖圖示 🔒，並渲染教師指定之提示字樣（如「請看講台專心聽課」）。
- **底層輸入攔截**：註冊 Windows 低階鍵盤鉤子（`WH_KEYBOARD_LL`）與滑鼠事件攔截，遮蔽 Win 鍵、Alt+Tab、Alt+Esc、Ctrl+Esc、Alt+F4 及滑鼠點擊。
- **全維度控制 (2-A)**：
  - 頂部導航列：支援「🔒 鎖定全班 / 🔓 解鎖全班」。
  - 畫布座位卡片：卡片懸浮與右鍵選單支援「鎖定此機 / 解鎖此機」，鎖定時卡片邊框呈現琥珀金標記（`border-amber-500` 與 `🔒 鎖定` 標籤）。
  - 批次框選列：支援框選多台後一鍵「🔒 批次鎖定 / 🔓 批次解鎖」。
  - 焦點視窗（`FocusModal`）：頂部提供黑屏鎖定快捷切換。
- **重連防繞過機制**：教師端後端持久維護 `lockedAgents: Set<string>`，若學生重新開機或重啟 Agent，WebSocket 握手後伺服器自動補發 `LOCK_SCREEN` 指令，徹底杜絕學生重啟繞過管制的手段。

### 10.2 學生畫面示範轉播全班 (Feature 3)
- **零拷貝極速中繼管線**：
  - 示範學生機以 DXGI + MFT 硬體編碼將 30 FPS H.264 串流透過反向 WebSocket 推送至教師端 Node.js。
  - 後端 `broadcastStreamer.ts` 啟用 `sourceType: 'student-relay'`，將收到的二進位 NALU 串流直接寫入 FFmpeg `stdin`，並以 `-c:v copy` 直推 UDP RTP 多播（`239.255.42.100:9000`），達到 **0% 伺服器額外 CPU 負擔**；若啟用錄影則以 `tee` 格式同步錄製至 MP4。
- **防鏡像遞迴與學生無干擾設計 (3-A)**：
  - 示範學生電腦右下角顯示半透明微光提示（`💡 您的螢幕正在全班轉播展示中`，`WS_EX_NOACTIVATE` 確保不搶奪鍵盤打字焦點）。
  - 學生端 `rtp_receiver.cpp` 於多播接收處檢查 `Utils::IsShowcaseActive()`，**本機正被轉播時強制抑制彈出全螢幕，杜絕畫面鏡像遞迴閉環**。
- **雙入口啟動 (4-A)**：
  - 畫布座位卡片懸浮快捷鍵支援「📡 轉播此學生畫面給全班」。
  - 焦點監看視窗（`FocusModal`）頂部整合「📡 轉播給全班 / ⏹ 停止轉播」切換按鈕。
  - 頂部導航列動態顯示「📡 轉播中: [學生名] [停止]」狀態燈。

---

## 📁 11. 課堂作業批次收取與自動歸檔 (Classroom Assignment Dropbox)

### 11.1 學生端 Windows 原生拖曳視窗 (Feature 2 / 1-B)
- **原生拖曳上傳 (1-B)**：
  - 學生端 C++ 原生視窗（`GridSightAssignmentDropZone`，`WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_EX_TOPMOST`），呼叫 `DragAcceptFiles(hwnd, TRUE)` 攔截 `WM_DROPFILES`。
  - 學生直接從 Windows 檔案總管或桌面將作業檔案拖入視窗即可上傳，完全無需開啟瀏覽器。
  - 視窗內建防呆副檔名校驗（如限制 `.cpp, .py, .zip`）與單檔大小上限檢查，上傳成功時發出系統提示音（`MessageBeep`）並顯示檔名與大小。
- **自動覆蓋更新最新版 (2-A)**：
  - 伺服器端標準化路徑：`data/assignments/<作業ID>/[座號]_[電腦名稱]_[原檔名]`。
  - 同位學生若重複拖曳上傳，系統自動覆蓋舊檔並更新繳交時間與檔案大小，確保教師收到的始終為學生最新版本。

### 11.2 教師端全維度管理與零依賴 ZIP 打包 (3-A)
- **即時繳交回饋**：
  - 畫布座位卡片：已繳交之學生卡片頂部即時顯示綠色 `📁 已繳` 徽章，滑鼠懸浮可預覽繳交檔名與檔案大小。
  - 頂部導航列：動態顯示琥珀綠色脈衝按鈕 `📁 收取中: [作業名稱] (已繳數/總數)`。
  - 懸浮框選操作列（`MonitorBatchToolbar`）：支援針對選定學生發起作業收取。
- **一鍵催繳與全班打包**：
  - 一鍵催繳：向所有連線中且「尚未繳交」之學生機再次發送 `COLLECT_ASSIGNMENT` 彈窗。
  - 零依賴全班 ZIP 打包（[`zipPacker.ts`](console/server/zipPacker.ts)）：純 Node.js 原生實作 deflate 與 CRC32 封包，點擊「下載全班作業打包」直接透過 HTTP 串流下載包含所有學生作業的 ZIP 壓縮檔，隨身碟一鍵帶走。

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
7. **測試完成拆除叢集**：
   ```bash
   docker compose -f docker-compose.test-cluster.yml down
   ```

---

## 📋 13. 課堂動態點名與學號簽到系統 (Classroom Dynamic Roll Call System)

### 13.1 學生端開機無痕與出站反向 WebSocket 動態點名
- **移除開機搶焦點視窗**：
  - 徹底移除舊版代理啟動強制彈出輸入學號之互動。`gs-agent.exe` 開機啟動時完全在背景無痕執行（`-mwindows`）。
- **動態指令派發與原生彈窗**：
  - 教師端點擊頂部導航列「📋 點名」或「批次點名」時，後端伺服器透過出站反向 WebSocket 發送 `START_ROLL_CALL` 指令（附帶 `rollCallId` 與 `title`）。
  - 學生端 C++ 收到指令後彈出置頂對話框（Windows 原生 Win32 Dialog，支援 Enter 鍵快速送出與預填上次學號；Linux 環境提供自動簽到 stub 支援無介面自動化測試）。
  - 簽到完成後立即向教師端回傳 `ROLL_CALL_RESPONSE` WebSocket 封包，並更新記憶體學號。每秒快照推送 (`POST /api/agent/snapshot`) 標頭亦同步帶上 `X-Student-Id`。

### 13.2 教師端座席卡片極簡化設計 (Minimalist Student Card)
- **資訊減法原則**：
  - 使用者介面嚴格遵循「保留即時截圖及學生學號」原則。
  - 卡片頂部標頭：僅顯示座號、在線狀態圓點與學號徽章（`🎓 {studentId}` 或 `未簽到`）。
  - 卡片主體：由即時截圖填滿（保持 16:9 縮圖即時畫面，無黑邊），徹底移除卡片正面雜亂的硬體遙測儀表（CPU/RAM/Disk、焦點視窗標題等，移至焦點檢視與滑鼠懸浮選單）。
  - 滑鼠懸浮座位卡片提供「🔄 要求重填學號」快捷按鈕，支援教師在學生填錯時單獨要求重填。

### 13.3 名冊管理、持久化與匯出
- **狀態管理與持久化**：
  - 點名工作階段即時維護各機簽到紀錄（學號、電腦名稱、IP、座號、簽到時間戳），自動持久化儲存至伺服器 `data/attendance.json`。
- **名冊匯出**：
  - 支援一鍵下載 UTF-8 BOM CSV 名冊（`GET /api/rollcall/export-csv`），相容 Microsoft Excel 直接點開正常顯示中文字元無亂碼。



