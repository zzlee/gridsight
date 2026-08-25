export type ConnectionStatus = 'online' | 'degraded' | 'offline';

export interface DiscoveredAgent {
  hostname: string;
  ip: string;
  port?: number;
  mac: string;
  username?: string;
  token?: string;
  activeWindow?: string;
  window_title?: string;
  specs?: DeviceSystemInfo;
  thumbnailBase64?: string;
  lastSeen?: number;
}

export interface DeviceSystemInfo {
  status?: string;
  active_window?: string;
  service?: string;
  hostname?: string;
  os?: string;
  uptime?: number;
  cpu: {
    model: string;
    cores: number;
    usage_percent: number;
  };
  ram: {
    total_mb: number;
    avail_mb: number;
    usage_percent: number;
  };
  disk: {
    drive: string;
    total_gb: number;
    free_gb: number;
    usage_percent: number;
  };
}

export interface StudentDevice {
  id: string;             // Unique MAC or UUID
  hostname: string;       // e.g. PC-01 to PC-70
  ip: string;             // e.g. 192.168.1.101
  mac: string;            // e.g. 00:1A:2B:3C:4D:5E
  username: string;       // e.g. Student01
  seatNo: string;         // e.g. "A1", "01", "Seat-1"
  gridX: number;          // Column position on grid (0-indexed)
  gridY: number;          // Row position on grid (0-indexed)
  status: ConnectionStatus;
  latencyMs: number;
  lastSeen: number;
  token?: string;
  thumbnailUrl?: string;
  activeWindow?: string;
  isOffTask?: boolean;
  selected?: boolean;
  specs?: DeviceSystemInfo;
}

export interface GridAisle {
  id: string;
  type: 'vertical' | 'horizontal';
  index: number; // Grid index where aisle sits
  label?: string;
}

export interface GridObstacle {
  id: string;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  label: string;
  type: 'podium' | 'pillar' | 'blackboard' | 'door';
}

export interface ClassroomLayout {
  id: string;
  name: string;
  rows: number;
  cols: number;
  seats: StudentDevice[];
  aisles: GridAisle[];
  obstacles: GridObstacle[];
  offTaskKeywords?: string[];
}

export type AppMode = 'MONITOR' | 'EDIT_LAYOUT' | 'BROADCAST';
