import dgram from 'dgram';
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
  specs?: DeviceSystemInfo;
  thumbnailBase64?: string;
  lastSeen: number;
}

export class MulticastDiscoveryService {
  private server: dgram.Socket | null = null;
  private multicastAddress = process.env.DISCOVERY_MULTICAST_IP || '239.255.42.99';
  private port = process.env.DISCOVERY_PORT ? parseInt(process.env.DISCOVERY_PORT, 10) : 9001;
  private tokenAuth: TokenAuthority;
  private onDeviceDiscovered?: ((device: DiscoveredAgent) => void) | undefined;
  private activeDevices = new Map<string, DiscoveredAgent>(); // key: mac or ip

  constructor(tokenAuth: TokenAuthority, onDeviceDiscovered?: ((device: DiscoveredAgent) => void) | undefined) {
    this.tokenAuth = tokenAuth;
    this.onDeviceDiscovered = onDeviceDiscovered;
  }

  start() {
    this.server = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.server.on('listening', () => {
      try {
        this.server?.addMembership(this.multicastAddress);
        logger.info(`[Discovery] Multicast listener joined ${this.multicastAddress}:${this.port}`);
      } catch (err: any) {
        logger.warn(`[Discovery] Note: Multicast membership add failed (${err.message}). Listening on UDP port.`);
      }
    });

    this.server.on('message', (msg, rinfo) => {
      try {
        const payload = JSON.parse(msg.toString('utf-8'));
        if (payload.type === 'BEACON') {
          const mac = payload.mac || rinfo.address;
          // Generate Session Token
          const token = this.tokenAuth.generateToken(mac, rinfo.address);

          // Reply with Token Uni-cast
          const reply = JSON.stringify({
            type: 'TOKEN_GRANT',
            token,
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

  getDevices(): DiscoveredAgent[] {
    const now = Date.now();
    const result: DiscoveredAgent[] = [];
    for (const [key, dev] of this.activeDevices.entries()) {
      if (now - dev.lastSeen < 30000) {
        // Active within 30s
        result.push(dev);
      } else {
        this.activeDevices.delete(key);
      }
    }
    return result;
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
