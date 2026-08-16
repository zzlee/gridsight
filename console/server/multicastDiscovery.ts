import dgram from 'dgram';
import { TokenAuthority } from './tokenAuthority.js';

export class MulticastDiscoveryService {
  private server: dgram.Socket | null = null;
  private multicastAddress = '239.255.42.99';
  private port = 9001;
  private tokenAuth: TokenAuthority;
  private onDeviceDiscovered?: (device: any) => void;

  constructor(tokenAuth: TokenAuthority, onDeviceDiscovered?: (device: any) => void) {
    this.tokenAuth = tokenAuth;
    this.onDeviceDiscovered = onDeviceDiscovered;
  }

  start() {
    this.server = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.server.on('listening', () => {
      this.server?.addMembership(this.multicastAddress);
      console.log(`[Discovery] Multicast listener joined ${this.multicastAddress}:${this.port}`);
    });

    this.server.on('message', (msg, rinfo) => {
      try {
        const payload = JSON.parse(msg.toString('utf-8'));
        if (payload.type === 'BEACON') {
          // Generate Session Token
          const token = this.tokenAuth.generateToken(payload.mac, rinfo.address);

          // Reply with Token Uni-cast
          const reply = JSON.stringify({
            type: 'TOKEN_GRANT',
            token,
            teacherIp: rinfo.address,
            sessionDurationSec: 10800,
          });

          this.server?.send(reply, rinfo.port, rinfo.address);

          if (this.onDeviceDiscovered) {
            this.onDeviceDiscovered({
              hostname: payload.hostname,
              ip: rinfo.address,
              mac: payload.mac,
              username: payload.username,
              token,
              lastSeen: Date.now(),
            });
          }
        }
      } catch (err) {
        console.error('[Discovery] Error processing beacon packet:', err);
      }
    });

    this.server.bind(this.port);
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
