export type ConnectionStatus = 'online' | 'degraded' | 'offline';

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
  selected?: boolean;
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
}

export type AppMode = 'MONITOR' | 'EDIT_LAYOUT' | 'BROADCAST';

export interface BroadcastConfig {
  active: boolean;
  multicastIp: string;
  port: number;
  fps: number;
  bitrateKbps: number;
  screenSource: string;
}
