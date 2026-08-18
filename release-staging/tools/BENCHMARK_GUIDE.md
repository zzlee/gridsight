# GridSight 70+ 路多路高併發壓力測試指南 (Benchmark Guide)

本指南用於測試當教室規模擴展至 **70 ~ 100+ 路學生端** 同時連線、即時縮圖輪詢、硬體遙測與畫布渲染時，系統（Ubuntu 教師端主機與瀏覽器客戶端）的 **CPU、RAM、網路頻寬與幀率（FPS）表現**。

---

## 🛠️ 一、環境準備

| 角色 | 作業系統 / 環境 | 執行元件 |
| :--- | :--- | :--- |
| **模擬學生端 (Mock Cluster)** | Windows 10/11 或 Linux | `tools/mock_agents.py` (Python 3.8+) |
| **教師端服務器 (Console Host)** | Linux Ubuntu 22.04/24.04 | Docker Compose (`gridsight-console`) |
| **監控終端 (Teacher Client)** | 任何 Chrome / Edge 瀏覽器 | Web UI (`http://<Ubuntu_IP>:3000`) |

---

## 🚀 二、快速開始測試

### 步驟 1：在 Windows 測試機啟動 Mock Agent 叢集

1. 下載或複製專案中的 `tools/mock_agents.py` 至 Windows 測試機。
2. （選用）安裝 `Pillow` 以產生帶有浮水印、時鐘與狀態的擬真教學畫面：
   ```powershell
   pip install pillow
   ```
3. 執行模擬器（預設模擬 70 台，開埠 8081 ~ 8150）：
   ```powershell
   python mock_agents.py --count 70
   ```
   > 💡 如需自訂參數：
   > `python mock_agents.py --count 80 --base-port 8081 --interval 1.0`

---

### 步驟 2：在 Ubuntu 教師端開啟資源監控

在 Ubuntu 伺服器開啟兩個終端視窗：

#### 視窗 A：監控 Docker 容器即時負載
```bash
docker stats gridsight-console --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

#### 視窗 B：記錄系統整體 CPU / 記憶體日誌 (每秒輸出)
```bash
vmstat 1 60
```

---

### 步驟 3：在瀏覽器中排入 70 路畫面

1. 在教師端開啟瀏覽器進入 `http://<Ubuntu_IP>:3000`。
2. 解鎖控制台並點擊上方「**佈局編輯**」。
3. 點擊「**矩陣尺寸**」➔ 輸入 `10 × 7`（70 席位）或 `9 × 8`（72 席位）➔ 點擊確認。
4. 點擊右上角「**設備池**」➔ 點擊「**依序填入空白座位**」。
5. 切換回「**監看模式**」➔ 觀察全班 70 台畫面的即時更新與流暢度。

---

## 📊 三、效能指標觀測重點 (KPIs)

| 觀測項目 | 目標健康範圍 | 測量方式 |
| :--- | :--- | :--- |
| **Console Docker CPU** | `< 15%` | `docker stats gridsight-console` |
| **Console Docker RAM** | `< 150 MB` | `docker stats gridsight-console` |
| **網路總頻寬消耗 (70路)** | `1.0 ~ 2.0 MB/s` | `docker stats` 中的 `Net I/O` |
| **前端瀏覽器渲染幀率** | `55 ~ 60 FPS` | Chrome DevTools (F12) ➔ `Rendering` ➔ `Frame Rendering Stats` |
| **前端 JS Heap 記憶體** | `< 200 MB (平穩無暴增)` | Chrome DevTools ➔ `Memory` |

---

## 🎯 四、進階單路 30FPS 串流壓力測試

在 70 路同時監看的狀態下：
1. **雙擊（Double Click）任一張學生卡片** 進入「焦點全螢幕監看（Focus Mode）」。
2. 觀測在背景維持 70 路輪詢的同時，單路 WebCodecs 30FPS 硬解串流是否依然保持 `< 100ms` 超低延遲與流暢運作。
