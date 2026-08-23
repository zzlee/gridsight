# GridSight 實機 (Windows) 除錯計畫 — Debug Runbook

> 適用情境：模擬環境（Docker / mock agents / Xvfb）驗證完成後，於真實 Windows 教室部署時的系統化除錯流程。
>
> 本文件假設：教師端為 Windows（gs-console.exe 或 portable zip），學生端為 `gs-agent.exe` v5.4.x。

---

## 📌 0. 可觀測性現況盤點（除錯前必讀）

| 元件 | 日誌/診斷管道 | 位置 |
| :--- | :--- | :--- |
| 學生端 `gs-agent.exe` | 檔案日誌（5MB 輪轉 → `.log.1`） | **行程 CWD** 下的 `gs-agent.log` |
| 學生端 Watchdog | 心跳檔（60s 無心跳自動重啟 worker） | 行程 CWD 下的 `gs-heartbeat.txt` |
| 教師端 Console | 檔案日誌（所有 `[Discovery]` `[WS Relay]` `[Broadcast]` 事件） | CWD 下 `gridsight-server.log`，可用 `LOG_FILE_PATH` 覆寫 |
| 教師端瀏覽器 | 串流品質 HUD（FPS/解碼延遲/幀型）、硬體遙測 HUD | 焦點監看視窗頂部圖示開啟（預設關閉） |

**關鍵注意事項：**
- 學生端以 `WinMain` 編譯（無主控台輸出），`gs-agent.log` 是**唯一**日誌管道。CWD 取決於啟動方式：經 `/join` 一鍵安裝時為 `%TEMP%`；請用 Process Explorer 或 `Get-Process gs-agent | select Path` 確認實際路徑。
- 架構為「Watchdog 主程序 + Worker 子程序」：worker 崩潰會被靜默重啟，**任務管理員看到程序存在 ≠ 功能正常**，必須看日誌。
- Windows 單檔版 `gs-console.exe` **未內建 FFmpeg**：廣播功能需另行安裝（見 §2.4）。

---

## 🔧 1. 階段〇：實機測試前的可觀測性補強

### 1.1 啟用 Crash Dump 收集（每台學生機執行一次）
```powershell
# WER LocalDumps：gs-agent.exe 崩潰時留存 minidump
$key = "HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\gs-agent.exe"
New-Item -Path $key -Force | Out-Null
Set-ItemProperty $key -Name DumpFolder -Value "C:\GridSightDumps" -Type ExpandString
Set-ItemProperty $key -Name DumpType -Value 2 -Type DWord   # 2 = full dump
New-Item -ItemType Directory -Path "C:\GridSightDumps" -Force | Out-Null
```
崩潰後取 `C:\GridSightDumps\*.dmp`，於開發機以 WinDbg 執行 `!analyze -v`。

### 1.2 Debug 版學生端（互動式主控台）
```bash
# MinGW 改用 console subsystem，可在前景直接看 stdout + gs-agent.log
make -C beacon CXX=x86_64-w64-mingw32-g++ LDFLAGS="-mconsole"
```
雙機除錯時優先使用 debug 版；量產部署再用 `-mwindows` 正式版。

### 1.3 一鍵診斷收集腳本
建議提供 `scripts/collect-windows-diagnostics.ps1`（收集：gs-agent.log 尾端 200 行、防火牆規則、多播群組成員、路由表、行程清單、WER 事件）。產出單一 zip 供離線分析。

---

## 🖥️ 2. 階段一：單機迴圈測試（Console + Agent 同機）

目的：排除網路因素，先證明「行程能跑、協議能通」。

| # | 步驟 | 預期結果 | 失敗時檢查 |
| :- | :--- | :--- | :--- |
| 2.1 | 手動啟動 debug 版 agent | `gs-agent.log` 出現 `Watchdog spawned worker process` | 缺 VC++ Runtime?（靜態編譯應無）；防毒攔截？ |
| 2.2 | `curl http://127.0.0.1:8080/ping` | `{"status":"ok","service":"GridSight Beacon"}` | 8080 被占？`netstat -ano \| findstr 8080` |
| 2.3 | 啟動 console（同機） | server.log：`Multicast listener joined 239.255.42.99:8888` | 多播被防火牆擋？見 §5 |
| 2.4 | 等待 ≤ 5 秒 | server.log 出現該機 BEACON 註冊；Web UI 設備池出現本機 | TTL=2 與網卡選擇（虛擬網卡優先問題，§5.4） |
| 2.5 | 點擊座位開啟焦點監看 | 30 FPS 畫面出現 | 看 HUD 幀型；agent.log 的 START_STREAM 行 |
| 2.6 | 測試分享網址/檔案至本機 | 瀏覽器開啟 / Downloads 出現檔案並開啟資料夾 | WS 送達？（server.log `[WS Relay] Sent ...`） |
| 2.7 | 安裝 FFmpeg 後啟動廣播 | 本機彈出全螢幕廣播視窗* | §2.4 FFmpeg PATH；RTPReceiver 目前 RenderFrame 為 stub（見 §6 已知限制） |

*\*注意：`RTPReceiver::RenderFrame()` 尚未完成解碼繪製（protocol_spec §4 TODO），學生端「收得到封包但畫不出來」屬預期，驗證基準為 IGMP 加入與 RTP 封包到達。*

---

## 🌐 3. 階段二：雙機最小區網測試

### 3.1 防火牆前置
`install-agent.ps1` 已自動建立 `GridSight Agent` In/Out 規則；教師端首次啟動 node.exe 時的防火牆彈窗必須允許（私人網路）。驗證：
```powershell
Get-NetFirewallRule -DisplayName "GridSight*" | ft DisplayName,Enabled,Direction,Action
Test-NetConnection <教師IP> -Port 3000        # 學生機 → 教師端 TCP 3000
```

### 3.2 五條通訊路徑逐一驗證矩陣

| 路徑 | 學生端驗證方式 | 教師端證據 |
| :--- | :--- | :--- |
| Discovery (UDP 8888 多播) | `pktmon filter add -i 239.255.42.99` + `pktmon start --etw -m real-time`；或 Wireshark filter `udp.port==8888` | server.log `[Discovery]` 註冊行 |
| Token Grant (UDP 單播回應) | agent.log 中 TOKEN_GRANT 接收紀錄 | — |
| Snapshot Push (TCP 3000) | agent.log 每秒 POST 成功紀錄；`curl http://<教師>:3000/api/snapshot/<MAC> -o s.jpg` | Web UI 縮圖更新 |
| Reverse WebSocket | agent.log 反向連線建立行 | server.log `[WS Relay]` |
| Broadcast RTP (UDP 9000) | `netsh int ipv4 show joins` 應含 239.255.42.100；Wireshark `rtp` | ffmpeg stderr / `/api/broadcast/status` |

### 3.3 快速隔離法
任一路徑不通時，於**學生機**直接對教師端發測試包，二分法定位是「發送端」還是「鏈路」問題：
```powershell
# 模擬一顆 BEACON（應使教師端立刻註冊此假裝置）
python scripts/test-network-multicast.py   # 於學生機執行（或單發一次）
```

---

## 🏫 4. 階段三：教室規模部署

1. **IGMP Snooping 驗證**：核心交換器需啟用 Snooping + Querier（見 `docs/igmp_snooping_setup.md`）。症狀：單機正常、全班廣播時交換器 Flooding 導致頻寬崩潰。
2. **70 台同時上線衝擊**：心跳已含 3.5~5s 抖動設計；若 server.log 出現大量同秒註冊，檢查是否有機器時間同步異常。
3. **混合模式壓力測試**：先 `scripts/mock-70-agents.js` 打滿 70 裝置註冊，再加入 5~10 台實機觀察 console CPU/RAM 與快照延遲。

---

## 🚨 5. 症狀快速對照表 (Symptom Playbook)

| 症狀 | 最可能原因 | 診斷指令 |
| :--- | :--- | :--- |
| Web UI 完全看不到某台機器 | 多播被擋／虛擬網卡搶先宣告 | `netsh int ipv4 show joins`、`route print`、停用 VirtualBox/VMware/Hyper-V 網卡重試 |
| 設備出現但縮圖黑灰 | Agent DXGI 擷取失敗（Session 0 / RDP 登入） | agent.log 搜尋 `Capture`；確認實體登入 Session 1（`query session`） |
| 縮圖有、焦點串流黑畫面 | H.264 編碼器初始化失敗 | agent.log 搜尋 `START_STREAM` 後的 ERROR；HUD 是否有幀送達 |
| OPEN_URL/分享檔沒反應 | 反向 WS 未連上 | 兩端 log 各查 `[WS Relay]` 與 reverse connect 行；`Test-NetConnection 教師IP -Port 3000` |
| 廣播按鈕亮起但學生端無反應 | ①FFmpeg 未安裝 ②RenderFrame stub ③交換器 IGMP | ①API 回傳之錯誤訊息（新版會回 500+原因）②§2.7 注意事項 ③Querier/Snooping |
| Agent 程序一直重生 | Worker 死循環 | agent.log 搜尋 `Worker process exited`；附帶 exit code 判讀 |
| 學生機 CPU 高 | 30FPS 編碼持續運轉 | 確認焦點視窗是否忘記關閉（viewer close 才送 STOP_STREAM） |

---

## 🧰 6. 工具速查

| 用途 | 內建工具 | 進階工具 |
| :--- | :--- | :--- |
| 封包擷取 | `pktmon`（Win10+/Server2019+） | Wireshark（filter: `udp.port==8888 \|\| udp.port==9000 \|\| tcp.port==3000`） |
| 連線測試 | `Test-NetConnection`、`curl.exe`（Win10 1803+ 內建） | nmap/portqry |
| 行程與控制代碼 | `tasklist /v`、`taskkill /f /im gs-agent.exe` | Process Explorer（查 CWD、子程序樹）、Process Monitor（檔案/登錄追蹤） |
| 崩潰分析 | 事件檢視器 → Windows Logs → Application（Source: Windows Error Reporting） | WinDbg Preview `!analyze -v`、procdump `-e` |
| 防火牆 | `netsh advfirewall firewall show rule name=all` | — |
| 即時除錯日誌 | — | Sysinternals DebugView（若 agent 未來加 `OutputDebugStringA`） |

---

## ✅ 7. 上線檢查清單（Checklist）

- [ ] 每台學生機可取得 `gs-agent.log` 且無 ERROR 循環
- [ ] WER LocalDumps 已設定（§1.1）
- [ ] 教師端 `LOG_FILE_PATH` 指向固定磁碟路徑
- [ ] FFmpeg 已安裝且 `ffmpeg -version` 可執行（教師機）
- [ ] 交換器 Snooping + Querier 已啟用並驗證
- [ ] 雙機測試五路徑全綠（§3.2 矩陣）
- [ ] 已知限制已向授課教師說明：RTP 廣播接收端渲染尚未完成、macOS 不支援
