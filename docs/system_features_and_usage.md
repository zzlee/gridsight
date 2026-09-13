# GridSight 系統架構與功能說明

本文件整理自原 `AGENTS.md`，包含系統架構設計、通訊規範與各項功能細節。

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
  - `screen_capture.cpp`（編譯為 `bin/GridSightScreenCapture.exe`）：Windows 原生擷取管線硬體合成器（Option A / OBS 模式），以 DXGI Desktop Duplication 零拷貝截圖，於視訊影格記憶體內直接烙印真實游標、點擊擴散波紋與滾輪指示，以 rawvideo 管道直推 FFmpeg 壓縮為 H.264 廣播串流，教師桌面 100% 純淨且完全不使用透明疊加視窗。
  - `mouse_overlay.cpp`（編譯為 `bin/GridSightMouseOverlay.exe`）：Windows 原生低階滑鼠鉤子無介面守護行程（Headless Hook Daemon），即時截取滑鼠事件並以 stdout 輸出，供 UDP 9002 Input RTP 廣播與學生端視窗平滑跟隨使用。

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

---
