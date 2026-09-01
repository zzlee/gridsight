import dgram from 'dgram';
import { logger } from './logger.js';

export enum InputEventType {
  MouseMove = 1,
  MouseDown = 2,
  MouseUp = 3,
  Scroll = 4,
  KeyState = 5,
}

export interface InputEventData {
  eventType: InputEventType;
  normX?: number; // 0..65535
  normY?: number; // 0..65535
  buttonFlags?: number; // bit 0: Left, bit 1: Right, bit 2: Middle
  scrollDelta?: number; // int16 (-32768..32767)
  modifierFlags?: number; // bit 0: Ctrl, bit 1: Shift, bit 2: Alt, bit 3: Meta
  keyCode?: number; // uint32
  timestampMs?: number; // uint64 ms
}

export interface InputRtpStreamerOptions {
  multicastIp?: string;
  port?: number;
  localIp?: string;
  ssrc?: number;
}

export class TeacherInputRtpStreamer {
  private socket: dgram.Socket | null = null;
  private isStreaming = false;
  private sequenceNumber = 0;
  private ssrc: number;
  private multicastIp: string;
  private port: number;
  private localIp?: string;

  constructor(options: InputRtpStreamerOptions = {}) {
    this.multicastIp = options.multicastIp || process.env.INPUT_MULTICAST_IP || '239.255.42.100';
    this.port = options.port || (process.env.INPUT_PORT ? parseInt(process.env.INPUT_PORT, 10) : 9002);
    this.localIp = options.localIp;
    this.ssrc = options.ssrc || (Math.floor(Math.random() * 0xffffffff) >>> 0);
  }

  public start(): boolean {
    if (this.isStreaming) return true;

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket.bind(() => {
        if (!this.socket) return;
        try {
          this.socket.setMulticastTTL(2);
          if (this.localIp && this.localIp !== '127.0.0.1') {
            this.socket.setMulticastInterface(this.localIp);
          }
        } catch (err) {
          logger.warn(`[InputRTP] Setting multicast interface options failed: ${err}`);
        }
      });

      this.isStreaming = true;
      logger.info(`[InputRTP] Input RTP Streamer active on multicast ${this.multicastIp}:${this.port} (SSRC=${this.ssrc})`);
      return true;
    } catch (err) {
      logger.error(`[InputRTP] Failed to start Input RTP Streamer: ${err}`);
      this.isStreaming = false;
      this.socket = null;
      return false;
    }
  }

  public stop(): void {
    if (!this.isStreaming) return;
    this.isStreaming = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    logger.info('[InputRTP] Input RTP Streamer stopped.');
  }

  public isActive(): boolean {
    return this.isStreaming && !!this.socket;
  }

  public createRtpPacket(event: InputEventData): Buffer {
    const packet = Buffer.alloc(12 + 21);

    // RTP Header (12 bytes)
    // Byte 0: V=2 (10), P=0, X=0, CC=0 => 0x80
    packet.writeUInt8(0x80, 0);
    // Byte 1: M=0, PT=98 => 0x62
    packet.writeUInt8(0x62, 1);
    // Byte 2-3: Sequence number
    packet.writeUInt16BE(this.sequenceNumber & 0xffff, 2);
    this.sequenceNumber = (this.sequenceNumber + 1) & 0xffff;

    // Byte 4-7: Timestamp (RTP timestamp in 90kHz ticks based on event time)
    const nowMs = event.timestampMs ?? Date.now();
    const rtpTimestamp = (Math.floor(nowMs * 90) >>> 0);
    packet.writeUInt32BE(rtpTimestamp, 4);

    // Byte 8-11: SSRC
    packet.writeUInt32BE(this.ssrc >>> 0, 8);

    // Payload (21 bytes starting at offset 12)
    const payloadOffset = 12;
    // Byte 0: eventType (uint8)
    packet.writeUInt8(event.eventType & 0xff, payloadOffset + 0);
    // Byte 1-2: normX (uint16)
    packet.writeUInt16BE(Math.min(65535, Math.max(0, Math.floor(event.normX ?? 0))), payloadOffset + 1);
    // Byte 3-4: normY (uint16)
    packet.writeUInt16BE(Math.min(65535, Math.max(0, Math.floor(event.normY ?? 0))), payloadOffset + 3);
    // Byte 5: buttonFlags (uint8)
    packet.writeUInt8((event.buttonFlags ?? 0) & 0xff, payloadOffset + 5);
    // Byte 6-7: scrollDelta (int16)
    packet.writeInt16BE(Math.min(32767, Math.max(-32768, Math.floor(event.scrollDelta ?? 0))), payloadOffset + 6);
    // Byte 8: modifierFlags (uint8)
    packet.writeUInt8((event.modifierFlags ?? 0) & 0xff, payloadOffset + 8);
    // Byte 9-12: keyCode (uint32)
    packet.writeUInt32BE((event.keyCode ?? 0) >>> 0, payloadOffset + 9);
    // Byte 13-20: timestampMs (uint64)
    packet.writeBigUInt64BE(BigInt(nowMs), payloadOffset + 13);

    return packet;
  }

  public sendEvent(event: InputEventData): boolean {
    if (!this.isStreaming || !this.socket) {
      return false;
    }

    try {
      const packet = this.createRtpPacket(event);
      this.socket.send(packet, 0, packet.length, this.port, this.multicastIp, (err) => {
        if (err) {
          logger.warn(`[InputRTP] Error sending packet: ${err.message}`);
        }
      });
      return true;
    } catch (err) {
      logger.warn(`[InputRTP] Exception sending input event packet: ${err}`);
      return false;
    }
  }
}
