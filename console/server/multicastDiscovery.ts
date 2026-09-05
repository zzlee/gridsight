import dgram from 'dgram';
import os from 'os';
import { TokenAuthority } from './tokenAuthority.js';
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
  token?: string;
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

export class MulticastDiscoveryService {
  private server: dgram.Socket | null = null;
  private multicastAddress = process.env.MULTICAST_IP || process.env.DISCOVERY_MULTICAST_IP || '239.255.42.99';
  private port = process.env.MULTICAST_PORT
    ? parseInt(process.env.MULTICAST_PORT, 10)
    : process.env.DISCOVERY_PORT
    ? parseInt(process.env.DISCOVERY_PORT, 10)
    : 8888;
  private tokenAuth: TokenAuthority;
  private onDeviceDiscovered?: ((device: DiscoveredAgent) => void) | undefined;
  private activeDevices = new Map<string, DiscoveredAgent>(); // key: mac or ip
  private deviceIndex = new Map<string, DiscoveredAgent>(); // O(1) secondary index by normalized mac, ip, hostname, id
  private listening = false;
  private joinedRoutes = 0;
  private lastError = '';

  constructor(tokenAuth: TokenAuthority, onDeviceDiscovered?: ((device: DiscoveredAgent) => void) | undefined) {
    this.tokenAuth = tokenAuth;
    this.onDeviceDiscovered = onDeviceDiscovered;
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

  start(selectedInterfaceIp?: string) {
    this.server = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.server.on('listening', () => {
      let joinedCount = 0;

      // 1. Join specifically on the user selected Interface IP if provided
      if (selectedInterfaceIp && selectedInterfaceIp !== '0.0.0.0' && selectedInterfaceIp !== '127.0.0.1') {
        try {
          this.server?.addMembership(this.multicastAddress, selectedInterfaceIp);
          joinedCount++;
        } catch (err: unknown) {
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
      logger.info(`[Discovery] Multicast listener joined ${this.multicastAddress}:${this.port} across ${joinedCount} network route(s)`);
    });

    this.server.on('error', (err) => {
      this.listening = false;
      this.lastError = err.message;
      logger.error(`[Discovery] UDP socket error: ${err.message}`);
    });

    this.server.on('message', async (msg, rinfo) => {
      try {
        let payload;
        try {
          payload = JSON.parse(msg.toString('utf-8'));
        } catch (parseErr) {
          logger.debug(`[Discovery] Ignoring malformed UDP payload from ${rinfo.address}`);
          return;
        }
        const pType = (payload.type || '').toUpperCase();
        if (pType === 'BEACON') {
          const mac = payload.mac || rinfo.address;
          // Generate Session Token
          const token = this.tokenAuth.generateToken(mac, rinfo.address);

          // Compute HMAC signature so agent can verify this is from the real server
          const signature = await this.tokenAuth.signTokenGrant(token, mac);

          // Reply with Token Uni-cast
          const reply = JSON.stringify({
            type: 'TOKEN_GRANT',
            token,
            signature,
            teacherIp: rinfo.address,
            sessionDurationSec: 10800,
          });

          this.server?.send(reply, rinfo.port, rinfo.address);

          const agent: DiscoveredAgent = {
            hostname: payload.hostname || `Host-${rinfo.address.replace(/\./g, '-')}`,
            ip: rinfo.address,
            mac,
            username: payload.username || 'Student',
            token,
            activeWindow: payload.active_window || payload.window_title || '桌面 (Desktop)',
            specs: payload.specs,
            lastSeen: Date.now(),
          };

          const isNew = !this.activeDevices.has(mac);
          const oldDev = this.activeDevices.get(mac);
          if (oldDev) {
            this.unindexDevice(oldDev);
          }

          this.activeDevices.set(mac, agent);
          this.indexDevice(agent);

          if (isNew && this.onDeviceDiscovered) {
            this.onDeviceDiscovered(agent);
          }
        }
      } catch (err) {
        logger.error('[Discovery] Error processing beacon packet:', err);
      }
    });

    this.server.bind(this.port);
  }

  getHealth() {
    return {
      listening: this.listening,
      joinedRoutes: this.joinedRoutes,
      lastError: this.lastError || undefined,
      activeDevices: this.activeDevices.size,
    };
  }

  getDevices(): DiscoveredAgent[] {
    const now = Date.now();
    const result: DiscoveredAgent[] = [];
    for (const [key, dev] of this.activeDevices.entries()) {
      if (now - dev.lastSeen < 6000) {
        // Active within 6s (agent sends beacon every 1~2s)
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
      if (now - candidate.lastSeen < 6000) {
        return candidate;
      } else {
        this.unindexDevice(candidate);
        this.activeDevices.delete(candidate.mac);
        return undefined;
      }
    }

    // Fallback if not found in index or for safety
    return undefined;
  }

  stop() {
    this.listening = false;
    this.joinedRoutes = 0;
    this.deviceIndex.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
