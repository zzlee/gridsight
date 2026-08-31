# GridSight Agent & Developer Knowledge Base (AGENTS.md)

本文件整理 GridSight 系統之架構設計、通訊規範、維運指令、常見陷阱與歷史決策，供後續維護、協作開發及 AI Agent 快速掌握核心邏輯。

---

## 📌 1. 系統架構與專案全覽 (Architecture Overview)

GridSight 專為 70 台具備還原卡之 Windows 電腦教室打造，兼顧極簡部署、低頻寬常態監看、30 FPS 焦點調閱與全體廣播。

### 模組架構
- **`beacon/`（學生端代理 - `gs-agent.exe`）**：
  - Windows x64 原生 C++ 撰寫，MinGW-w64 靜態編譯（無依賴、`-mwindows` 背景無痕執行）。
  - 支援 DXGI 螢幕擷取、OpenH264 編碼、原生 HTTP Snapshot 伺服器、WebSocket 串流推送、UDP RTP 多播接收。
- **`console/`（教師端管理介面 - `gs-console`）**：
  - 前端：React 18 + Vite + TailwindCSS（支援座位拖曳排版、走道/講台設定、WebCodecs GPU 硬體解碼播放器）。
  - 後端：Node.js Express + WebSocket Relay + UDP 多播探索服務（Port 3000）。
  - 獨立單檔版：`release/gs-console.exe`（內建 Node.js 執行期環境與 Web 靜態資源，雙擊即啟動）。
- **`tools/`（測試與模擬工具）**：
  - `mock_agents.py`：支援一鍵模擬 70+ 台學生機心跳宣告與虛擬螢幕縮圖。

---

## ⚡ 2. 網路通訊協定與連接埠規範 (Critical Port Conventions)

> [!IMPORTANT]
> **全系統標準通訊連接埠統一為 `3000`**。
> 絕不可在程式碼或文件中混用或寫死 `3001`（`3001` 為早期本機前後端分離開發之歷史殘留）。

| 協定 / 服務 | 埠號 / 組播位址 | 說明 |
| :--- | :--- | :--- |
| **教師端 Web & API** | **`TCP 3000`** | 託管 Web UI、REST API（`/api/...`）、WebSocket 中繼（`/ws/...`）與腳本下載 |
| **學生端多播探索 (Beacon)** | **`UDP 239.255.42.99:8888`** | 學生端啟動時發送心跳，教師端監聽此多播以動態發現學生機 |
| **教師畫面全班廣播 (RTP)** | **`UDP 239.255.42.100:9000`** | 教師螢幕 H.264 廣播，支援三檔品質（高 1080p30/8M、中 720p30/4M、低 480p15/1.5M；交換器 IGMP Snooping 硬體複製） |
| **學生端本地 Snapshot** | **不開埠 (僅出站推送)** | 學生端主動向教師端 `POST /api/agent/snapshot` 推送縮圖 |

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
- **一鍵 Docker 編譯**：
  ```bash
  ./scripts/build-docker.sh
  ```
  > 執行後自動拉起 `Dockerfile.builder`（Ubuntu 22.04 + MinGW-w64），在容器內以 `x86_64-w64-mingw32-g++` 靜態編譯所有 `beacon/src/*.cpp`。
- **產物位置**：`beacon/gs-agent.exe`（約 3.5 MB）
- **手動 Docker 操作**（進階）：
  ```bash
  # 單次編譯（不執行 build-docker.sh）
  docker build -t gridsight-builder:latest -f Dockerfile.builder .
  docker run --rm -v "$(pwd):/workspace" gridsight-builder:latest \
    make -C beacon clean all CXX=x86_64-w64-mingw32-g++
  ```

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
- **打包指令**：
  ```bash
  npm run build:portable
  # 或 node scripts/build-windows-portable.js
  ```
- **產物位置**：`release/gridsight-console-portable.zip`（約 27 MB）
- **特性**：
  - **100% 絕不觸發 Windows Defender / SmartScreen 警告**。
  - 內嵌微軟 / OpenJS 官方認證數位簽章之原生 `node.exe`。
  - 支援多網卡終端機互動挑選與自動啟動，包含 `start-console.bat`（一鍵啟動並自動開啟瀏覽器）與 `stop-console.bat`（一鍵停止）。

### 4.3 Linux Docker 容器部署
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

## 🔍 6. 焦點監控與除錯開關 (Focus Viewer & HUD)

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
  - 隨 UDP 多播心跳封包（`active_window`，每 3.5~5 秒隨機抖動發送）以及每秒 HTTP 快照請求標頭（`X-Active-Window: base64`）同步上報。
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
   git tag -a v5.8.3 -m "Release v5.8.3: ..."
   git push origin v5.8.3
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
