import dgram from 'dgram';
import os from 'os';
import { logger } from './logger.js';

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

export interface DiscoveredAgent {
  id?: string;
  hostname: string;
  ip: string;
  mac: string;
  username?: string;
  studentId?: string | undefined;
  checkInTime?: number | undefined;
  activeWindow?: string;
  status?: string;
  seatNo?: string;
  specs?: DeviceSystemInfo;
  thumbnailBase64?: string;
  lastSeen: number;
}

const normalizeTargetKey = (raw: string) => {
  if (!raw) return '';
  return decodeURIComponent(raw).replace(/%3A/gi, ':').trim().toUpperCase();
};

/**
 * Teacher-side multicast discovery service (new architecture).
 *
 * Direction reversed vs the old BEACON flow:
 *   - The teacher periodically broadcasts a `DISCOVERY` announcement
 *     (teacherIp / teacherPort / version) to 239.255.42.99:8888 every ~3s.
 *   - Students listen on that multicast group and then establish a single
 *     outbound reverse WebSocket to `teacherIp:teacherPort/ws/agent`.
 *
 * The device roster is therefore no longer fed by student UDP beacons. It is
 * maintained lazily by the server via `upsertDevice()` — called whenever a
 * student agent registers over WebSocket (`AGENT_INFO_REGISTER`) or pushes a
 * snapshot. `getDevices()`/`findDevice()` keep the same API surface so all
 * existing route consumers work unchanged.
 */
export class MulticastDiscoveryService {
  private server: dgram.Socket | null = null;
  private multicastAddress = process.env.MULTICAST_IP || process.env.DISCOVERY_MULTICAST_IP || '239.255.42.99';
  private port = process.env.MULTICAST_PORT
    ? parseInt(process.env.MULTICAST_PORT, 10)
    : process.env.DISCOVERY_PORT
    ? parseInt(process.env.DISCOVERY_PORT, 10)
    : 8888;
  private teacherPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  private selectedInterfaceIp: string | undefined;
  private readonly version: string;
  private activeDevices = new Map<string, DiscoveredAgent>(); // key: mac or ip
  private deviceIndex = new Map<string, DiscoveredAgent>(); // O(1) secondary index by normalized mac, ip, hostname, id
  private listening = false;
  private joinedRoutes = 0;
  private lastError = '';
  private broadcastTimer: NodeJS.Timeout | null = null;
  // Stale threshold: keep discovering for a few beacon intervals after the
  // last WS/snapshot contact (agent pushes a snapshot roughly every second).
  private readonly STALE_MS = 20_000;

  constructor(version = '') {
    this.version = version;
  }

  private indexDevice(dev: DiscoveredAgent) {
    if (dev.mac) {
      const normMac = normalizeTargetKey(dev.mac);
      if (normMac) this.deviceIndex.set(normMac, dev);
      this.deviceIndex.set(dev.mac, dev);
    }
    if (dev.ip) {
      this.deviceIndex.set(dev.ip, dev);
    }
    if (dev.hostname) {
      this.deviceIndex.set(dev.hostname, dev);
    }
    if (dev.id) {
      this.deviceIndex.set(dev.id, dev);
    }
  }

  private unindexDevice(dev: DiscoveredAgent) {
    if (dev.mac) {
      const normMac = normalizeTargetKey(dev.mac);
      if (normMac && this.deviceIndex.get(normMac) === dev) this.deviceIndex.delete(normMac);
      if (this.deviceIndex.get(dev.mac) === dev) this.deviceIndex.delete(dev.mac);
    }
    if (dev.ip && this.deviceIndex.get(dev.ip) === dev) {
      this.deviceIndex.delete(dev.ip);
    }
    if (dev.hostname && this.deviceIndex.get(dev.hostname) === dev) {
      this.deviceIndex.delete(dev.hostname);
    }
    if (dev.id && this.deviceIndex.get(dev.id) === dev) {
      this.deviceIndex.delete(dev.id);
    }
  }

  /**
   * Register/refresh a student agent in the roster. Called by server.ts when
   * an agent completes its WS handshake (`AGENT_INFO_REGISTER`) or pushes a
   * snapshot. Replaces the old BEACON-based registration.
   */
  upsertDevice(patch: Partial<DiscoveredAgent> & { mac: string; ip: string }): DiscoveredAgent {
    const key = patch.mac || patch.ip;
    const existing = this.activeDevices.get(key);
    const now = Date.now();

    const merged: DiscoveredAgent = {
      ...(existing || {}),
      ...patch,
      hostname: patch.hostname || existing?.hostname || `Host-${String(patch.ip).replace(/\./g, '-')}`,
      username: patch.username || existing?.username || 'Student',
      studentId: patch.studentId !== undefined ? patch.studentId : existing?.studentId,
      checkInTime: patch.checkInTime !== undefined ? patch.checkInTime : existing?.checkInTime,
      activeWindow: patch.activeWindow || existing?.activeWindow || '桌面 (Desktop)',
      lastSeen: now,
    };

    if (existing) this.unindexDevice(existing);
    this.activeDevices.set(key, merged);
    this.indexDevice(merged);
    return merged;
  }

  /** Just refresh liveness + optional fields for an already-known device. */
  touchDevice(target: string, patch?: Partial<DiscoveredAgent>) {
    const dev = this.findDevice(target);
    if (!dev) return dev;
    if (patch) {
      if (patch.activeWindow) dev.activeWindow = patch.activeWindow;
      if (patch.seatNo) dev.seatNo = patch.seatNo;
      if (patch.status) dev.status = patch.status;
      if (patch.studentId !== undefined) dev.studentId = patch.studentId;
      if (patch.checkInTime !== undefined) dev.checkInTime = patch.checkInTime;
      if (patch.specs) dev.specs = { ...dev.specs, ...patch.specs } as DeviceSystemInfo;
    }
    dev.lastSeen = Date.now();
    return dev;
  }

  private resolveTeacherIp(): string {
    if (this.selectedInterfaceIp && this.selectedInterfaceIp !== '0.0.0.0' && this.selectedInterfaceIp !== '127.0.0.1') {
      return this.selectedInterfaceIp;
    }
    try {
      const interfaces = os.networkInterfaces();
      for (const addrs of Object.values(interfaces)) {
        for (const a of addrs || []) {
          if (a.family === 'IPv4' && !a.internal) return a.address;
        }
      }
    } catch {}
    return '127.0.0.1';
  }

  private sendAnnouncement = () => {
    const s = this.server;
    if (!s) return;
    const teacherIp = this.resolveTeacherIp();
    const payload = JSON.stringify({
      type: 'DISCOVERY',
      teacherIp,
      teacherPort: this.teacherPort,
      version: this.version,
    });
    s.send(payload, this.port, this.multicastAddress, (err) => {
      if (err) logger.warn(`[Discovery] Broadcast announce failed: ${err.message}`);
    });
  };

  start(selectedInterfaceIp?: string) {
    this.selectedInterfaceIp = selectedInterfaceIp;
    this.server = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.server.on('listening', () => {
      let joinedCount = 0;

      // 1. Join specifically on the user selected Interface IP if provided
      if (selectedInterfaceIp && selectedInterfaceIp !== '0.0.0.0' && selectedInterfaceIp !== '127.0.0.1') {
        try {
          this.server?.addMembership(this.multicastAddress, selectedInterfaceIp);
          joinedCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[Discovery] Add membership on ${selectedInterfaceIp} failed: ${msg}`);
        }
      }

      // 2. Also join on all valid IPv4 non-internal adapters for redundancy
      try {
        const interfaces = os.networkInterfaces();
        for (const [name, addrs] of Object.entries(interfaces)) {
          if (!addrs) continue;
          for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal && addr.address !== selectedInterfaceIp) {
              try {
                this.server?.addMembership(this.multicastAddress, addr.address);
                joinedCount++;
              } catch {
                // Some virtual adapters may reject IGMP join, ignore
              }
            }
          }
        }
      } catch {}

      // 3. Fallback default addMembership
      try {
        this.server?.addMembership(this.multicastAddress);
        joinedCount++;
      } catch {}

      this.listening = true;
      this.joinedRoutes = joinedCount;
      this.lastError = '';
      logger.info(
        `[Discovery] Announcing DISCOVERY on ${this.multicastAddress}:${this.port} across ${joinedCount} network route(s) every 3s`
      );
    });

    this.server.on('error', (err) => {
      this.listening = false;
      this.lastError = err.message;
      logger.error(`[Discovery] UDP socket error: ${err.message}`);
    });

    this.server.bind(this.port);

    // Periodically announce "teacher online" so listening students can connect.
    this.sendAnnouncement();
    this.broadcastTimer = setInterval(this.sendAnnouncement, 3000);
  }

  getHealth() {
    return {
      listening: this.listening,
      joinedRoutes: this.joinedRoutes,
      lastError: this.lastError || undefined,
      activeDevices: this.activeDevices.size,
      mode: 'broadcast',
    };
  }

  getDevices(): DiscoveredAgent[] {
    const now = Date.now();
    const result: DiscoveredAgent[] = [];
    for (const [key, dev] of this.activeDevices.entries()) {
      if (now - dev.lastSeen < this.STALE_MS) {
        // Active (WS connected or snapshot received within threshold)
        result.push(dev);
      } else {
        this.unindexDevice(dev);
        this.activeDevices.delete(key);
      }
    }
    return result;
  }

  findDevice(target: string): DiscoveredAgent | undefined {
    if (!target) return undefined;
    const now = Date.now();

    // Check direct index first (normalized MAC, raw MAC, IP, Hostname, ID)
    const normKey = normalizeTargetKey(target);
    const candidate = this.deviceIndex.get(normKey) || this.deviceIndex.get(target);

    if (candidate) {
      if (now - candidate.lastSeen < this.STALE_MS) {
        return candidate;
      } else {
        this.unindexDevice(candidate);
        this.activeDevices.delete(candidate.mac || candidate.ip);
        return undefined;
      }
    }

    return undefined;
  }

  stop() {
    this.listening = false;
    this.joinedRoutes = 0;
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.deviceIndex.clear();
    this.activeDevices.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}