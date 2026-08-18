# GridSight 部署與維運指南 (Deployment Guide)

GridSight 針對 70 台具備還原卡之電腦教室設計了「零母機維護」的雲端熱拉取部署模式。

---

## 1. 學生端 (Beacon) 部署

### 1.1 雲端熱拉取原理
傳統電腦教室需在母機安裝軟體並派送還原鏡像。GridSight 採用 **PowerShell 一鍵熱拉取**：
1. 學生開機登入 Windows 後，於用戶權限（Session 1）執行單行指令。
2. 指令自學校內部 Web 伺服器下載最新的 `gs-agent.exe` 至 `%TEMP%` 並在背景啟動。
3. 還原卡重啟後 `%TEMP%` 自動清除，達到真正的零殘留與無感版本更新。

### 1.2 一鍵啟動指令
於 Windows 開機腳本、學生登入排程或終端中執行：
```powershell
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "irm http://192.168.1.200:3000/install-agent.ps1 | iex"
```

### 1.3 一鍵停止指令
若需要手動結束學生端背景代理程式，可使用以下任一方式：

- **方法 1：PowerShell 一鍵遠端停止（推薦）**
  ```powershell
  irm http://192.168.1.200:3000/stop-agent.ps1 | iex
  ```
- **方法 2：PowerShell 本地行程終止**
  ```powershell
  Stop-Process -Name "gs-agent" -Force
  ```
- **方法 3：CMD 命令提示字元**
  ```cmd
  taskkill /f /im gs-agent.exe
  ```
- **方法 4：工作管理員 (Task Manager)**
  按下 `Ctrl + Shift + Esc` 開啟工作管理員，在「詳細資料」分頁對 `gs-agent.exe` 點擊「結束工作」。

---

## 2. 教師端 (Console) 部署

### 2.1 系統需求
- **容器化部署 (推薦)**：Docker 20+ 與 Docker Compose（免安裝 Node.js 與 FFmpeg）
- **本地直接部署**：Node.js 20+，FFmpeg 5.0+ (用於教師螢幕廣播推流)
- **瀏覽器**：Google Chrome 94+ 或 Microsoft Edge 94+ (支援 WebCodecs API 硬體解碼)

### 2.2 容器化一鍵部署 (標準生產推薦)
使用 Docker Compose 啟動整合後端 API、組播探索、FFmpeg 廣播與靜態前端 UI 的完整服務：
```bash
# 1. 一鍵建置並在背景啟動
docker compose up -d

# 2. 產出一致性前端資產包：
./scripts/build-console-docker.sh
```
開啟瀏覽器訪問 `http://<TEACHER_IP>:3000` 即可進入管理畫布。

### 2.3 本地開發模式快速啟動
```bash
# 1. 進入 Console 目錄並安裝相依套件
cd console
npm install

# 2. 啟動教師端前端 (Port 3000) 與後端服務 (Port 3000)
npm run dev
# 另開終端啟動完整後端協調器 (或直接運行 server)
npm run server
```

---

## 3. 學生端 `gs-agent.exe` 容器化交叉編譯 (Docker Builder)

為了保證所有開發與部署環境中 MinGW-w64 工具鏈、Windows SDK 標頭檔版本與靜態連結旗標的 100% 一致性，**本專案要求使用 Docker Builder 容器進行編譯**。

### 3.1 標準 Docker 編譯指令
專案根目錄已提供一鍵編譯腳本：
```bash
# 執行標準 Docker 交叉編譯
./scripts/build-docker.sh
```

### 3.2 手動 Docker 指令
```bash
# 1. 建立 Docker Builder 映像檔
docker build -t gridsight-builder -f Dockerfile.builder .

# 2. 掛載當前目錄並執行 MinGW-w64 編譯
docker run --rm \
    -u "$(id -u):$(id -g)" \
    -v "$(pwd):/workspace" \
    gridsight-builder \
    make -C beacon clean all CXX=x86_64-w64-mingw32-g++
```

### 3.3 編譯產物特點
- **產物路徑**：`beacon/gs-agent.exe` (Windows x64 執行檔)
- **靜態無依賴**：啟用 `-static -static-libgcc -static-libstdc++`，學生端無需安裝任何 VC++ Redistributable 或外部 DLL。
- **無痕背景執行**：啟用 `-mwindows` 旗標，啟動時完全不彈出命令提示字元 (Console Window)。
