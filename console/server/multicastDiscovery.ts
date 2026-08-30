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
  hostname: string;
  ip: string;
  mac: string;
  username?: string;
  token?: string;
  activeWindow?: string;
  specs?: DeviceSystemInfo;
  thumbnailBase64?: string;
  lastSeen: number;
}

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
  private listening = false;
  private joinedRoutes = 0;
  private lastError = '';

  constructor(tokenAuth: TokenAuthority, onDeviceDiscovered?: ((device: DiscoveredAgent) => void) | undefined) {
    this.tokenAuth = tokenAuth;
    this.onDeviceDiscovered = onDeviceDiscovered;
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

    this.server.on('message', (msg, rinfo) => {
      try {
        const payload = JSON.parse(msg.toString('utf-8'));
        const pType = (payload.type || '').toUpperCase();
        if (pType === 'BEACON') {
          const mac = payload.mac || rinfo.address;
          // Generate Session Token
          const token = this.tokenAuth.generateToken(mac, rinfo.address);

          // Compute HMAC signature so agent can verify this is from the real server
          const signature = this.tokenAuth.signTokenGrant(token, mac);

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

          this.activeDevices.set(mac, agent);

          if (this.onDeviceDiscovered) {
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
        this.activeDevices.delete(key);
      }
    }
    return result;
  }

  stop() {
    this.listening = false;
    this.joinedRoutes = 0;
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
