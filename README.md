# GridSight: 70人電腦教室螢幕監控與實時廣播系統

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build Agent](https://github.com/your-username/gridsight/actions/workflows/build-agent.yml/badge.svg)](.github/workflows/build-agent.yml)
[![Build Console](https://github.com/your-username/gridsight/actions/workflows/build-console.yml/badge.svg)](.github/workflows/build-console.yml)
[![Architecture: v5.0](https://img.shields.io/badge/Spec-v5.0-emerald.svg)](docs/architecture.md)

**GridSight** 專為 70 台具備還原卡之 Windows 電腦教室打造，兼顧「實體座位自由排版」、「全班畫面低負載輪詢」、「單機 30 FPS 焦點調閱」與「教師畫面全體廣播」四大核心功能。

---

## 🌟 系統特色 (Core Highlights)

- 🎨 **客製化座位畫布 (Interactive Grid Canvas)**
  - 自由網格排版、磁吸對齊 (Snap-to-Grid) 與多選框選 (Lasso Selection)
  - 支援「中央走道」、「講台/黑板」、「立柱障礙物」實體教室格局模擬
  - 內建版型模板 (7×10 標準矩陣、左5×7+右5×7 雙分區、分組島嶼式)
  - 座位表一鍵 JSON 匯出/匯入與多班級切換
- ⚡ **三大影像傳輸模式 (Three Transmission Modes)**
  1. **全班常態監控**：480×270 @ 1 FPS，WebP/JPEG + HTTP Pull (附 800ms 熔斷)，全班僅佔 1.7% 頻寬 (~17 Mbps)
  2. **焦點單機調閱**：720p/1080p @ 30 FPS，按需 OpenH264 + WebSocket，WebCodecs GPU 硬體解碼 (<50ms 延遲)
  3. **教師全體廣播**：1080p @ 30 FPS，H.264 + UDP Multicast (RTP)，交換器 IGMP Snooping 硬體複製 (固定 4~6 Mbps 總頻寬)
- 🔒 **輕量無感部署與安全鑑權 (Zero-Maintenance & Security)**
  - **雲端熱拉取**：PowerShell 單行指令下載至 `%TEMP%` 於 Session 1 執行，避開 Session 0 隔離，還原卡零殘留
  - **RAM Dynamic Token**：啟動發送 UDP Multicast 主動宣告 (Beacon)，動態 Token 僅存放於記憶體，防範同儕偷窺
  - **強健底層**：DXGI `ACCESS_LOST` 自動重連、Per-Monitor DPI 自適應原生擷取、-mwindows 無視窗無痕執行

---

## 📊 三大傳輸模式效能指標

| 傳輸場景 | 解析度 / 幀率 | 編碼與傳輸協定 | 全班頻寬負載與效能指標 |
| :--- | :--- | :--- | :--- |
| **全班 70 台常態監控** | 480×270 @ 1 FPS | WebP/JPEG + HTTP Pull | 約 17 Mbps (佔 1GbE 頻寬 1.7%)，教師 CPU 解碼 < 15% |
| **單機/焦點實時監看** | 720p/1080p @ 30 FPS | H.264 (OpenH264) + WebSocket | 單機 2~4 Mbps，WebCodecs GPU 硬解延遲 < 50ms |
| **教師畫面全體廣播** | 1080p @ 30 FPS | H.264 + UDP Multicast (RTP) | 固定 4~6 Mbps (IGMP Snooping 硬體複製零延遲) |

---

## 🏗️ 系統架構 (Architecture)

```
+---------------------------------------------------------------------------------------------------------+
|                                    GridSight Console (教師端管理介面)                                     |
|  [可視化客製座位畫布 (拖曳排版/走道/分組)] ── 一鍵匯出/匯入 JSON ── 依實體教室格局自由映射               |
|  ├─ (模式1) 全班常態監看：1 FPS 縮圖輪詢 HTTP Pull (AbortController 800ms 熔斷) ──────────────────────+  |
|  ├─ (模式2) 焦點學生調閱：按需 WebSocket H.264 30FPS (WebCodecs GPU 硬體解碼 <50ms) ◀─────────────┐   |  |
|  └─ (模式3) 教師畫面廣播：H.264 UDP Multicast RTP (239.255.42.100:9000) ──────────────────────┐  │   |  |
+------------------------------------------------------------------------------------------│───│---+  |
                                                                                           │   │      |
    ┌──────────────────────────────────────────────────────────────────────────────────────┘   │      |
    ▼ (交換器 IGMP Snooping 硬體複製轉發，全班總頻寬固定 4~6 Mbps)                               │      |
+──────────────────────────────────────────────+  +────────────────────────────────────────────│─+    |
|        GridSight Beacon 01 (學生端)           |  |        GridSight Beacon 70 (學生端)        │ |    |
| [學生 Session 1 執行 gs-agent.exe (無UI背景)]|  | [學生 Session 1 執行 gs-agent.exe (無UI背景)]│ |    |
|  ├─ 啟動發送 UDP Multicast 主動宣告 (Beacon) |  |  ├─ 啟動發送 UDP Multicast 主動宣告 (Beacon) │ |    |
|  ├─ (模式1) Native HTTP Server /snapshot 回傳|  |  ├─ (模式1) Native HTTP Server /snapshot 回傳 │ |    |
|  ├─ (模式2) 按需啟動 OpenH264 WS 串流推流 ───┼──┼─ (模式2) [雙擊選中時] 啟動 30FPS 推流 ───────┘ │    |
|  └─ (模式3) D3D11 / SDL2 全螢幕置頂廣播接收  |  |  └─ (模式3) D3D11 / SDL2 全螢幕置頂廣播接收 ◀─────────┘    |
+──────────────────────────────────────────────+  +───────────────────────────────────────────────+
```

---

## 📁 專案目錄結構 (Project Structure)

```
gridsight/
├── .github/workflows/        # GitHub Actions CI/CD (MinGW 交叉編譯與前端建置)
│   ├── build-agent.yml
│   └── build-console.yml
├── beacon/                   # 學生端輕量代理 (C++ / Windows x64 Native Agent)
│   ├── CMakeLists.txt
│   ├── Makefile              # MinGW-w64 交叉編譯腳本
│   ├── include/              # DXGI 擷取、編碼器、HTTP/WS 伺服器、RTP 接收端標頭
│   ├── src/                  # C++ 核心實現
│   └── deploy/               # PowerShell 雲端熱拉取與開機啟動腳本
├── console/                  # 教師端管理介面 (React + Vite + TailwindCSS + Node.js)
│   ├── src/
│   │   ├── components/Canvas/   # 網格畫布、學生卡片、走道/講台標記、MiniMap
│   │   ├── components/Viewer/   # WebCodecs GPU 硬體解碼 30FPS 焦點播放器
│   │   ├── components/Broadcast/# 教師 UDP 組播廣播控制器
│   │   ├── services/            # 1 FPS 縮圖輪詢 (800ms 熔斷)、座位表儲存
│   │   └── types/               # TypeScript 資料型別定義
│   └── server/                  # 教師端探索監聽、Token 發放與 FFmpeg RTP 串流服務
├── docs/                     # 系統架構、通訊協定、部署與 IGMP Snooping 設定指南
│   ├── architecture.md
│   ├── protocol_spec.md
│   ├── deployment_guide.md
│   └── igmp_snooping_setup.md
├── scripts/                  # 交叉編譯與多播測試實用工具
│   ├── build-agent-cross.sh
│   ├── test-network-multicast.py
│   └── generate-sample-layout.py
├── LICENSE                   # MIT License
└── README.md
```

---

## 🚀 快速上手 (Quick Start)

### 1. 教師端管理介面 (GridSight Console)
```bash
# 進入 Console 目錄
cd console

# 安裝依賴套件
npm install

# 啟動 Web 介面
npm run dev

# 啟動後端協調器 (Discovery & Token Authority)
npm run server
```
開啟瀏覽器訪問 `http://localhost:3000`。

### 2. 學生端輕量代理 (GridSight Beacon) 交叉編譯
在 Linux (Ubuntu/Debian) 宿主機執行：
```bash
# 安裝 MinGW-w64 工具鏈
sudo apt-get install -y mingw-w64 cmake make

# 編譯 gs-agent.exe
cd beacon
make
```

### 3. 學生端一鍵熱拉取執行 (Windows Client)
學生端以單行 PowerShell 執行：
```powershell
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "irm http://<TEACHER_IP>:3000/install-agent.ps1 | iex"
```

---

## 📅 開發進度規劃 (Milestones)

- [x] **Milestone 1**：建置 MinGW 交叉編譯環境、DXGI 截圖、JPEG/WebP 壓縮與 HTTP `/snapshot` 服務。
- [x] **Milestone 2**：多播雙向探索 (UDP Beacon)、動態 RAM Token 注入與焦點單機 WebSocket 30FPS 串流。
- [x] **Milestone 3**：GridSight Console 可視化拖曳畫布、JSON 配置匯出入、WebCodecs GPU 硬解浮窗與 RTP Multicast 組播廣播。
- [x] **Milestone 4**：70 台自訂佈局對齊、800ms 熔斷併發輪詢壓測與全班廣播切換連線驗收。

---

## 📄 開源授權 (License)

本專案採用 [MIT License](LICENSE) 授權。
