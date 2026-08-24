export type ConnectionStatus = 'online' | 'degraded' | 'offline';

export interface DeviceSystemInfo {
  status?: string;
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
  id: string;
  hostname: string;
  ip: string;
  mac: string;
  username: string;
  seatNo: string;
  gridX: number;
  gridY: number;
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
  index: number;
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
