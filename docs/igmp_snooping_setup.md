# 70人教室 1Gbps LAN 交換器 IGMP Snooping 設定指南

在 70 台電腦的高密度局域網環境中，若未正確配置 IGMP Snooping，UDP Multicast 廣播會退化為全端口廣播風暴 (Broadcast Storm)，導致網絡擁塞。

---

## 1. 核心網路拓撲規範

- **核心交換器**：1Gbps Managed Switch (支援 IGMPv2 / IGMPv3 Snooping 與 IGMP Querier)
- **組播位址規劃**：
  - `239.255.42.99:8888`：Beacon 設備主動宣告與探索
  - `239.255.42.100:9000`：教師畫面全體 H.264 廣播
- **頻寬負載**：
  - 教師廣播發送端：依所選品質約 **1.5 / 4 / 8 Mbps**（高 1080p30 / 中 720p30 / 低 480p15）
  - 學生接收端：交換器硬體複製至 70 個端口，各端口同上述品質碼率

---

## 2. Cisco / D-Link / ZyXEL 交換器設定範例

### Cisco Catalyst 交換器
```cisco
configure terminal
ip igmp snooping
ip igmp snooping vlan 1
ip igmp snooping vlan 1 querier
ip igmp snooping vlan 1 fast-leave
end
write memory
```

### ZyXEL (合勤) 管理型交換器
1. 進入 Web 介面 -> **Advanced Application** -> **Multicast** -> **IGMP Snooping**。
2. 勾選 **Enable IGMP Snooping**。
3. 勾選 **IGMP Snooping Querier**，Querier Interval 設為 `125` 秒。
4. 勾選 **Fast Leave**，以利學生端停止廣播時立即釋放組播流。

---

## 3. 網絡診斷與驗收
使用 Wireshark 抓包驗證：
1. 教師端發起廣播時，未加入組播群組的設備不應收到 `239.255.42.100` 封包。
2. 70 台電腦同時接收廣播時，上行交換器總頻寬僅約 1.5~8 Mbps（依所選品質），全班流暢零延遲。
