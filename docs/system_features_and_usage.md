# GridSight 系統架構與功能說明 (System Features & Usage)

本文件完整整理 GridSight 系統之架構設計、通訊規範、各項課堂教學管理功能與進階多媒體影音管線細節。

---

## 📌 1. 系統架構與專案全覽 (Architecture Overview)

GridSight 專為具備還原卡之 Windows 電腦教室打造，兼顧極簡部署、低頻寬常態監看、30 FPS 焦點調閱、教師/學生示範全體廣播、以及雙軌螢幕錄影。

### 模組架構
- **`beacon/`（學生端代理 - `gs-agent.exe`）**：
  - Windows x64 原生 C++ 撰寫，MinGW-w64 靜態編譯（無依賴、`-mwindows` 背景無痕執行）。
  - 支援 DXGI 螢幕擷取、Media Foundation H.264 硬體編碼（軟體降級）、原生 HTTP Snapshot 伺服器、出站反向 WebSocket 串流推送、UDP RTP 多播接收。
  - 支援 Linux 環境原生編譯為 ELF 執行檔（ headless stub ），供 CI/CD 與雙容器 Docker 集群進行全功能自動化測試。
- **`console/`（教師端管理介面 - `gs-console`）**：
  - 前端：React 18 + Vite + TailwindCSS（支援座位拖曳排版、走道/講台設定、WebCodecs GPU 硬體解碼播放器、獨立歷史錄影庫與延遲基準測試 HUD）。
  - 後端：Node.js Express + WebSocket Relay + UDP 多播探索服務（統一 Port 3000）。
  - 打包發布：
    - Windows 官方簽名綠色便攜包：`release/gridsight-console-portable.zip`（內嵌官方認證數位簽章之 `node.exe` 與靜態 `ffmpeg.exe`，100% 絕不觸發防毒誤報）。
    - Windows 獨立單檔版：`release/gs-console.exe`。
    - Linux Docker 容器：`gridsight-console:latest`（雙容器測試標準環境）。
- **`tools/`（測試、特效與除錯工具）**：
  - `mock_agents.py`：支援一鍵模擬大量學生機在線註冊、虛擬螢幕縮圖與離題警示測試。
  - `ubuntu_agent_debugger.py`：支援 Ubuntu Linux 環境下即時多播解碼播放視窗（`ffplay`）與全彩即時事件除錯。
  - `screen_capture.cpp`（編譯為 `bin/GridSightScreenCapture.exe`）：Windows 原生擷取管線硬體合成器（Option A / OBS 模式），以 DXGI Desktop Duplication 零拷貝截圖，於視訊影格記憶體內直接烙印真實游標、點擊擴散波紋與滾輪指示，以 rawvideo 管道直推 FFmpeg 壓縮為 H.264 廣播串流，教師桌面 100% 純淨且完全不使用透明疊加視窗。
  - `mouse_overlay.cpp`（編譯為 `bin/GridSightMouseOverlay.exe`）：Windows 原生低階滑鼠鉤子無介面守護行程（Headless Hook Daemon），即時截取滑鼠事件並以 stdout 輸出，供 UDP 9002 Input RTP 廣播與學生端視窗平滑跟隨使用。
  - 自動化測試套件：包含 `test_rollcall_cluster.py`、`test_share_cluster.py`、`test_assignment_cluster.py`、`test_recording_cluster.py` 與 `test_student_record_cluster.py`。

---

## ⚡ 2. 網路通訊協定與連接埠規範 (Critical Port Conventions)

> [!IMPORTANT]
> **全系統標準通訊連接埠統一為 `3000`**。
> 絕不可在程式碼或文件中混用或寫死 `3001`（`3001` 為早期本機前後端分離開發之歷史殘留）。

| 協定 / 服務 | 埠號 / 組播位址 | 發起方向 | 說明 |
| :--- | :--- | :--- | :--- |
| **教師端 Web & REST API** | **`TCP 3000`** | 瀏覽器/學生 ➔ 教師 | 託管 Web UI、REST API（`/api/...`）、腳本下載與檔案收發 |
| **教師端多播探索 (Discovery)** | **`UDP 239.255.42.99:8888`** | 教師 ➔ 學生 (Multicast) | 教師端定期廣播「教師在線」宣告（含 Teacher IP 與 Port），學生端監聽後建立單一反向 WebSocket |
| **學生端反向 WebSocket (Relay)** | **`TCP 3000` (`/ws/agent`)** | 學生 ➔ 教師 (Outbound WS) | 學生端唯一長連線，傳輸註冊資訊、控制指令、與 30 FPS H.264 串流 |
| **焦點串流調閱 (Viewer WS)** | **`TCP 3000` (`/ws/stream/:id`)** | 瀏覽器 ➔ 教師 (WS) | 教師端 WebCodecsPlayer 連接後端轉發通道接收指定學生的 30 FPS H.264 串流 |
| **學生端縮圖推送 (Snapshot)** | **`TCP 3000` (`/api/agent/snapshot`)** | 學生 ➔ 教師 (HTTP POST) | 學生端每秒主動推送 480×270 JPEG 縮圖至教師端記憶體快取（零入站開埠） |
| **教師畫面全班廣播 (RTP)** | **`UDP 239.255.42.100:9000`** | 教師 ➔ 學生 (Multicast) | 教師螢幕 H.264 廣播，支援三檔品質（高 1080p30/8M、中 720p30/4M、低 480p15/1.5M；交換器 IGMP Snooping 硬體複製） |
| **教師滑鼠多播 (Input RTP)** | **`UDP 239.255.42.100:9002`** | 教師 ➔ 學生 (Multicast) | 教師即時滑鼠座標 (0..65535) 與點擊事件，供學生端視窗滑鼠自動跟隨與動畫特效 |

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

### 3.3 多播探索與日誌去重機制 (Multicast Discovery Deduplication)
- 教師端每隔 3 秒透過多播發送 `DISCOVERY` 廣播。
- 學生端 `gs-agent` 快取最新目標端點（`TEACHER_IP:PORT`），在教師端點保持不變的情況下，自動抑制重複的日誌打印與重複建立連線，避免日誌檔案膨脹並保障網路連線穩定。

---

## 🎨 4. 畫布佈局、走道與障礙物管理 (Grid Canvas & Layout)

### 4.1 矩陣維度定義
- 總行數 `layout.cols`（橫向直欄數，X）。
- 總列數 `layout.rows`（縱向橫列數，Y）。
- **注意**：`layout.rows` 為**真實實際列數**（例如 10 排即為 10，不額外減 1）。

### 4.2 走道劃分 (`layout.aisles`)
- 結構：`{ id: string, type: 'vertical' | 'horizontal', index: number, name?: string }`
- 畫布座標透過 `getVisualX` / `getVisualY` 轉換，遇到走道自動增加間距（`aisleGap = 36px`）並繪製虛線路徑標記。

### 4.3 講台與障礙物 (`layout.obstacles`)
- 支援類型：`podium` (講台 2×1/3×1)、`blackboard` (黑板 4×1)、`pillar` (立柱 1×1)、`door` (門 1×1)。
- 支援在「佈局編輯」模式下點擊右上角按鈕編輯座標、寬高跨度或刪除。

### 4.4 佈局安全持久化準則
- 當使用者在 `MatrixConfigModal` 中**修改教室名稱**或**調整矩陣尺寸**時：
  - **必須完整保留既有走道 (`layout.aisles`) 與障礙物 (`layout.obstacles`)**。
  - 僅清理超出新網格尺寸外的物件（Auto-bounds validation）。

### 4.5 批次操作 (Multi-Selection & Batch Edit)
- 支援滑鼠拉框框選 (Marquee Selection)、Ctrl / Shift 多選。
- 支援懸浮操作列（一鍵批次改名、自動重新編號、批次退回設備池）。

---

## 🔍 5. 焦點監控、WebCodecs GPU 解碼與流量統計 (Focus Viewer & Streaming)

### 5.1 30 FPS H.264 WebCodecs GPU 硬體解碼
- 雙擊學生卡片開啟 `FocusModal`，教師端透過 WebSocket 向該學生發送 `START_STREAM`。
- 學生端 DXGI 截圖並以 Media Foundation MFT 編碼為 H.264 NALU（Annex B 格式），直推反向 WebSocket。
- 前端瀏覽器調用現代 **WebCodecs API (`VideoDecoder`)** 直接送入 GPU 進行硬體解碼並繪製於 HTML5 Canvas，畫面延遲低於 50ms。

### 5.2 串流健康看門狗與 Snapshot Fallback (Watchdog & Recovery)
- `WebCodecsPlayer.tsx` 內建串流狀態看門狗：若因網路波動或瀏覽器分頁切換導致逾 10 秒 0 FPS，播放器自動發起重連或關鍵幀請求；若 WebCodecs API 不支援或嚴重解碼異常，系統無縫切換為 1 FPS Snapshot 輪詢備援模式，杜絕永久黑屏。

### 5.3 截圖功能與 HUD 遙測
- **截圖功能**：WebCodecs Player 透過 `captureSnapshot()` 將當前 GPU 渲染 Canvas 匯出為高畫質圖片（`GridSight_[seatNo]_[timestamp].jpg/.png`）。`FocusModal` 頂部提供 **JPEG / PNG** 切換（預設 JPEG Q85）並於下載後以 toast 顯示檔案大小。
- **HUD 狀態監控**：
  - 串流品質診斷 HUD（FPS、解碼延遲、幀類型）：點擊頂部活動圖示 📈 開啟。
  - 硬體遙測狀態 HUD（CPU、RAM、Disk）：點擊頂部資訊圖示 ℹ️ 開啟。
- **流量即時監測 (Traffic HUD)**：頂部導航列即時動態合併「常態 1 FPS 縮圖輪詢流量」與「全螢幕廣播 RTP 多播流量」，廣播時切換為紫色狀態燈並標註 `廣播`。

---

## 🚨 6. 學生端使用中視窗監控與離題警示 (Active Window & Off-Task Alert System)

### 6.1 視窗標題擷取與回傳
- **學生端 (`gs-agent.exe`)**：
  - 呼叫原生 Windows API `GetForegroundWindow()` 與 `GetWindowTextW()` 取得學生當前焦點應用程式視窗標題（如 `Visual Studio Code`、`YouTube - Google Chrome`）。
  - 連上教師端反向 WebSocket 後以 `AGENT_INFO_REGISTER` 上報初始值，並隨每秒 HTTP 快照請求標頭（`X-Active-Window: base64`）持續同步上報。

### 6.2 離題關鍵字庫與警示機制
- **預設關鍵字庫**：`YouTube`, `Bilibili`, `Roblox`, `Minecraft`, `Steam`, `Discord`, `Twitch`, `抖音`, `Tiktok`, `巴哈姆特`, `動畫瘋`, `Facebook`, `Instagram`, `Netflix`, `Game`, `遊戲`。
- **持久化**：關鍵字庫已全面持久化儲存於後端伺服器的 `data/seats.json`（`layout.offTaskKeywords`），任何裝置開啟教師端皆能同步同一套自訂字庫。
- **即時視覺回饋**：
  - 當學生視窗標題命中關鍵字時，座位卡片外框呈現**紅色警示脈衝光暈**（`ring-2 ring-rose-500/70 animate-pulse`）並標註 `⚠️ 離題`。
  - 頂部導航列顯示即時「**🚨 離題警示 (N台)**」按鈕，點擊一鍵在畫布上僅篩選離題學生。

---

## 📡 7. 教師畫面全體廣播與管線硬體合成特效 (Classroom Broadcast & Compositor)

### 7.1 三檔廣播品質快速切換
教師端頂部導航列「廣播畫面」按鈕旁提供高/中/低三檔品質選擇：
- **高 (1080p · 30 FPS · 8 Mbps)**：示範精細文字、高解析數位內容。
- **中 (720p · 30 FPS · 4 Mbps)**：預設檔位，平衡流暢度與頻寬。
- **低 (480p · 15 FPS · 1.5 Mbps)**：窄頻交換器或低階客戶端解碼防卡頓。

### 7.2 記憶體硬體合成游標與點擊波紋 (OBS 模式，零透明視窗)
- **架構**：透過 `tools/screen_capture.cpp`（`bin/GridSightScreenCapture.exe`），在 DXGI 抓取桌面影格後，於記憶體 32-bit BGR0 緩衝區直接以 GDI+ 烙印真實游標（`GetCursorInfo` + `Bitmap::FromHICON`）、點擊擴散光波與滾輪氣泡，隨後透過 stdout 管道直推 FFmpeg `stdin` 壓縮為 H.264 串流。
- **優勢**：(1) 教師桌面 100% 純淨零干擾；(2) 0ms 完美影格同步；(3) 教師錄影 MP4 原生自帶特效；(4) 學生端純解碼零額外負擔。

### 7.3 UDP 9002 Input RTP 廣播
- 後端啟動無頭滑鼠守護行程（`bin/GridSightMouseOverlay.exe`），截取滑鼠事件以 RFC 3550 RTP 多播至 `239.255.42.100:9002`。學生端視窗模式下可自動平滑跟隨教師滑鼠平移。

---

## 🔒 8. 學生螢幕黑屏鎖定與示範轉播 (Screen Lock & Showcase Relay)

### 8.1 螢幕黑屏與鍵鼠鎖定 (Screen Lockout)
- **視覺呈現**：Slate-950（`#0B1120`）深藍全螢幕置頂視窗，中央 GDI 繪製金色大鎖圖示 🔒，並渲染提示字樣（如「請看講台專心聽課」）。
- **底層輸入攔截**：註冊 Windows 低階鍵盤鉤子（`WH_KEYBOARD_LL`）與滑鼠事件攔截，遮蔽 Win 鍵、Alt+Tab、Alt+F4 及滑鼠點擊。
- **重連防繞過機制**：教師端後端持久維護 `lockedAgents: Set<string>`，若學生重新開機或重啟 Agent，WebSocket 握手後伺服器自動補發 `LOCK_SCREEN` 指令，徹底杜絕學生重啟繞過管制的手段。

### 8.2 學生畫面示範轉播全班 (Showcase Relay)
- **零拷貝極速中繼**：示範學生機以 DXGI + MFT 硬體編碼將 30 FPS H.264 串流透過反向 WebSocket 推送至教師端 Node.js，後端以 `-c:v copy` 直推 UDP RTP 多播（`239.255.42.100:9000`），達到 **0% 伺服器額外 CPU 轉碼負擔**。
- **防鏡像遞迴設計**：示範學生電腦右下角顯示半透明微光提示（`💡 您的螢幕正在全班轉播展示中`），學生端 `rtp_receiver.cpp` 偵測到轉播中時**強制抑制彈出全螢幕，杜絕畫面鏡像遞迴閉環**。

---

## 📁 9. 課堂作業批次收取與自動歸檔 (Classroom Assignment Dropbox)

### 9.1 學生端 Windows 原生拖曳視窗
- 學生端 C++ 原生置頂拖曳視窗（`GridSightAssignmentDropZone`），呼叫 `DragAcceptFiles` 攔截 `WM_DROPFILES`。
- 學生直接從 Windows 檔案總管或桌面將作業檔案拖入視窗即可上傳，完全無需開啟瀏覽器。
- 內建副檔名防呆校驗（如 `.cpp, .py, .zip`）與大小上限檢查。

### 9.2 自動覆蓋更新與零依賴 ZIP 打包
- **最新版覆蓋歸檔**：伺服器儲存路徑為 `data/assignments/<作業ID>/[座號]_[電腦名稱]_[原檔名]`，重複繳交自動覆蓋更新，教師始終獲得最新版本。
- **零依賴全班 ZIP 打包**：純 Node.js 原生實作 deflate 與 CRC32 串流封包，點擊「下載全班作業打包」直接透過 HTTP 串流下載整包已按座號排序好的 ZIP 壓縮檔。

---

## 🌐 10. 課堂教材分發：網址與檔案派送 (URL & File Sharing)

### 10.1 全班 / 定向網址推播
- 教師端點擊「分享網址」，輸入 URL 並選擇全班或選定座位。
- 學生端反向 WS 收到 `OPEN_URL` 指令後，自動呼叫預設瀏覽器（Chrome/Edge）於前景開啟該網頁。

### 10.2 教材檔案分發至學生桌面
- 教師端上傳講義、練習素材或起始程式碼專案包至伺服器暫存區。
- 後端下發 `SHARE_FILE` 指令，學生端背景將檔案下載至學生 Windows 桌面並自動呼叫檔案總管或預設程式打開。

---

## 📋 11. 課堂動態點名與學號簽到系統 (Classroom Dynamic Roll Call System)

### 11.1 學生端開機無痕與出站反向 WS 動態點名
- 徹底移除舊版代理啟動強制彈出輸入學號之互動。`gs-agent.exe` 開機啟動時完全在背景無痕執行（`-mwindows`）。
- 教師發起點名時，伺服器透過反向 WebSocket 發送 `START_ROLL_CALL` 指令，學生端彈出原生 Win32 對話框供學生輸入學號簽到。
- 簽到完成後立即向教師端回傳 `ROLL_CALL_RESPONSE` WebSocket 封包，每秒快照推送標頭亦同步帶上 `X-Student-Id`。

### 11.2 教師端座席卡片極簡化設計與 CSV 匯出
- 卡片頂部僅保留座號、在線狀態與學號徽章（`🎓 {studentId}` 或 `未簽到`），卡片主體由 16:9 即時截圖填滿。
- 支援個別學生重填學號（右鍵「要求重填學號」）。
- 點擊「匯出簽到表 (CSV)」，立即下載帶有 UTF-8 with BOM 之 CSV 檔案，Microsoft Excel 點開完美無亂碼。

---

## 🎥 12. 雙軌錄影系統與獨立歷史錄影庫 (Comprehensive Recording System)

### 12.1 教師端螢幕錄影（自選音訊與廣播防嘯叫強隔離）
- **音訊裝置自選**：DirectShow (Windows) / PulseAudio (Linux) 實體麥克風、立體聲混音 (Stereo Mix) 或純視訊錄製。
- **雙軌廣播強隔離**：錄製聲音時，若同時進行全班廣播，音訊**嚴格僅錄入教師端本機 MP4 檔案**，多播廣播串流維持強制靜音，100% 杜絕全班喇叭回音嘯叫。
- **斷電保護**：採用 Fragmented MP4 封裝格式（`+frag_keyframe+empty_moov`），即便突然中斷電源亦不會損壞已錄製視訊。

### 12.2 學生焦點畫面串流原生錄影 (Student Focus Stream Recording)
- 在學生卡片懸浮捷徑或 `FocusModal` 中點擊「錄製此畫面」，後端透過 FFmpeg Direct Stream Copy（`-c:v copy`）將學生傳來的 30 FPS H.264 串流直封為 MP4。
- **0% 伺服器轉碼 CPU 負擔**；自動首幀 IDR 關鍵幀注入，關閉焦點視窗時錄影後台持續錄製不受干擾。

### 12.3 獨立「歷史錄影清單」模組 (`RecordingsListModal.tsx`)
- 點擊頂部導航列 🎬 膠卷圖示即可隨時開啟獨立錄影清單。
- **功能特性**：
  - **分類篩選**：支援切換「全部」、「教師錄影」、「全體廣播」、「學生錄影」標籤。
  - **即時搜尋**：依檔名、學生機名稱或關鍵字秒級過濾。
  - **串流預覽**：後端支援標準 HTTP 206 Partial Content 與 `Range` 標頭，瀏覽器內建 HTML5 `<video>` 播放器隨選即播，支援進度條隨意跳轉拖曳。
  - **安全管理**：支援 MP4 一鍵下載帶走，與路徑穿越安全校驗刪除。

---

## ⏱️ 13. 廣播延遲與網路抖動基準量測 (Broadcast Latency & Jitter Benchmarking)

### 13.1 毫秒碼錶與同屏同畫閉環對比 (Broadcast Benchmark Tool)
- 點擊頂部導航列「更多工具 ➔ 廣播延遲量測」，開啟基準測試對話框。
- 整合 60 FPS 高精確度毫秒碼錶、250ms 循環色塊計數器、與學生端畫面即時閉環回傳視覺同屏對照，肉眼即可直觀驗證廣播到學生螢幕之端到端毫秒級延遲。

### 13.2 RFC 3550 RTP 封包抖動分析
- 搭配 `scripts/benchmark-broadcast-latency.py` 工具，解析 RTP 90kHz 視訊時脈計算網路到達抖動 (Interarrival Jitter)，並對示範轉播進行微秒級轉發延遲採樣。

---

## 🔐 14. 主控台安全性：PIN 碼保護與防爆破機制 (Console Security)

- **6 位數管理 PIN 碼**：離開講台時一鍵鎖定教師端控制台。
- **Per-IP 階梯式防爆破鎖定**：後端精確記錄各來源 IP 之連續錯誤嘗試，連續輸入錯誤將觸發漸進式鎖定（1分鐘 ➔ 5分鐘 ➔ 15分鐘），杜絕學生惡意猜測密碼。
- **Token 鑑權保護**：所有敏感控制 API（關機、鎖定、錄影、分享、作業下載）均需 Bearer Token 嚴格驗證。
