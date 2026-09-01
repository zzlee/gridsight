# 📚 GridSight Knowledge Base & Wiki

歡迎來到 **GridSight（70人電腦教室螢幕監控與實時廣播系統）** 官方技術知識庫與 Wiki。

---

## 📑 知識庫目錄導覽

1. **[系統完整開發歷程與技術演進全紀錄 (Development History)](development-history.md)**
   - 記錄從 v1.0 至 v5.8.4 的架構選型、效能突破、踩坑經驗與完整版本演進圖。
2. **[系統架構與設計規格 (Architecture)](../architecture.md)**
   - 深入探討三大影像傳輸模式、DXGI 擷取、IGMP Snooping 多播與 WebCodecs GPU 硬體解碼管線。
3. **[通訊協定規範書 (Protocol Spec)](../protocol_spec.md)**
   - 包含 UDP 8888 多播心跳 (Beacon)、HTTP 1 FPS 快照拉取、WebSocket 30 FPS H.264 推流與 RTP 多播廣播封包格式。
4. **[電腦教室交換器 IGMP Snooping 設定指南 (IGMP Snooping Setup)](../igmp_snooping_setup.md)**
   - Cisco、D-Link、Zyxel、TP-Link 等主流網管交換器多播設定步驟。
5. **[極速部署與維運手冊 (Deployment Guide)](../deployment_guide.md)**
   - 教師端免安裝綠色包、Docker 容器部署與學生端 1 秒極速加入操作流程。
6. **[Windows 除錯與常見問題排除 (Windows Debug Runbook)](../windows-debug-runbook.md)**
   - 網卡綁定、防火牆規則、Defender 排除與 Session 0 隔離診斷。
7. **[AI Agent 與開發者核心知識庫 (AGENTS.md)](../../AGENTS.md)**
   - 連接埠規範、佈局持久化原則、跨平台相容性與開發防呆準則。
8. **[前端畫布 Viewport Culling 與渲染效能改進計畫 (Viewport Culling Plan)](viewport-culling-optimization-plan.md)**
   - 詳細分析 70~100 台規模下的 DOM 節點虛擬化、React.memo 記憶化與 60 FPS 平移優化策略。
