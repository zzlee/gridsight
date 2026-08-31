import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { StudentDevice } from '../../types';
import { AuthService } from '../../services/authService';

export interface WebCodecsPlayerHandle {
  captureSnapshot: (format?: 'image/jpeg' | 'image/png', quality?: number) => Promise<Blob | null>;
  getCanvas: () => HTMLCanvasElement | null;
  startRecording: () => boolean;
  stopRecording: () => Promise<{ blob: Blob; mimeType: string } | null>;
  isRecording: () => boolean;
}

interface WebCodecsPlayerProps {
  device: StudentDevice;
  showDebugHud?: boolean;
  onStreamStatusChange?: (status: 'Connecting' | 'Live 30FPS' | 'Snapshot Fallback' | 'Offline', packets: number, rendered: number) => void;
}

export const WebCodecsPlayer = forwardRef<WebCodecsPlayerHandle, WebCodecsPlayerProps>(({ device, showDebugHud = false, onStreamStatusChange }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const renderedFrameRef = useRef(false);
  const statusRef = useRef<'Connecting' | 'Live 30FPS' | 'Snapshot Fallback' | 'Offline'>('Connecting');
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState(0);
  const [decoderMode, setDecoderMode] = useState<'WebCodecs GPU' | 'Canvas Fallback'>('WebCodecs GPU');
  const [streamStatus, setStreamStatus] = useState<'Connecting' | 'Live 30FPS' | 'Snapshot Fallback' | 'Offline'>('Connecting');
  const [debugStats, setDebugStats] = useState({
    packets: 0,
    kbReceived: 0,
    rendered: 0,
    lastNalType: 'None',
  });

  useImperativeHandle(ref, () => ({
    captureSnapshot: (format = 'image/jpeg', quality = 0.85) => {
      return new Promise<Blob | null>((resolve) => {
        if (!canvasRef.current || !renderedFrameRef.current) {
          resolve(null);
          return;
        }
        try {
          canvasRef.current.toBlob((blob) => {
            resolve(blob);
          }, format, quality);
        } catch (err) {
          console.warn('Canvas toBlob failed:', err);
          resolve(null);
        }
      });
    },
    getCanvas: () => canvasRef.current,
    startRecording: () => {
      if (!canvasRef.current || (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive')) {
        return false;
      }
      try {
        const stream = canvasRef.current.captureStream(30);
        recordedChunksRef.current = [];
        let mimeType = 'video/webm;codecs=vp9';
        if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
            ? 'video/webm;codecs=vp8'
            : MediaRecorder.isTypeSupported('video/webm')
            ? 'video/webm'
            : MediaRecorder.isTypeSupported('video/mp4')
            ? 'video/mp4'
            : '';
        }
        const recorderOptions = mimeType ? { mimeType } : undefined;
        const recorder = new MediaRecorder(stream, recorderOptions);
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;
        return true;
      } catch (err) {
        console.warn('[WebCodecsPlayer] Failed to start MediaRecorder:', err);
        return false;
      }
    },
    stopRecording: () => {
      return new Promise<{ blob: Blob; mimeType: string } | null>((resolve) => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === 'inactive') {
          resolve(null);
          return;
        }
        const usedMimeType = recorder.mimeType || 'video/webm';
        recorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: usedMimeType });
          recordedChunksRef.current = [];
          mediaRecorderRef.current = null;
          resolve({ blob, mimeType: usedMimeType });
        };
        try {
          recorder.stop();
        } catch (err) {
          console.warn('[WebCodecsPlayer] Error stopping MediaRecorder:', err);
          recordedChunksRef.current = [];
          mediaRecorderRef.current = null;
          resolve(null);
        }
      });
    },
    isRecording: () => {
      return !!mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive';
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isSubscribed = true;
    let renderCount = 0;
    let packetCount = 0;
    let totalBytes = 0;
    let hasReceivedKeyFrame = false;
    let lastTime = performance.now();
    let decoder: VideoDecoder | null = null;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let lastPacketReceivedAt = 0;
    renderedFrameRef.current = false;
    statusRef.current = 'Connecting';

    const reportStatus = (next: 'Connecting' | 'Live 30FPS' | 'Snapshot Fallback' | 'Offline') => {
      statusRef.current = next;
      setStreamStatus(next);
      onStreamStatusChange?.(next, packetCount, renderCount);
    };

    // 1. Setup FPS counter interval without closing over a stale React state value.
    const statsInterval = setInterval(() => {
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      setFps(Math.round(renderCount / delta));
      onStreamStatusChange?.(statusRef.current, packetCount, renderCount);
      renderCount = 0;
      lastTime = now;
    }, 1000);

    // 2. Initialize WebCodecs VideoDecoder with Level 4.2 High Profile (1080p 60fps support)
    const initDecoder = () => {
      const hasWebCodecs = typeof window !== 'undefined' && 'VideoDecoder' in window;
      if (hasWebCodecs) {
        try {
          decoder = new VideoDecoder({
            output: (videoFrame: VideoFrame) => {
              if (!isSubscribed) {
                videoFrame.close();
                return;
              }
              if (ctx) {
                if (canvas.width !== videoFrame.displayWidth || canvas.height !== videoFrame.displayHeight) {
                  canvas.width = videoFrame.displayWidth;
                  canvas.height = videoFrame.displayHeight;
                }
                ctx.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);
              }
              videoFrame.close();
              renderCount++;
              renderedFrameRef.current = true;
              if (lastPacketReceivedAt > 0) {
                setLatency(Math.max(0, Math.round(performance.now() - lastPacketReceivedAt)));
              }
              if (statusRef.current !== 'Live 30FPS') reportStatus('Live 30FPS');
              setDebugStats((prev) => ({ ...prev, rendered: prev.rendered + 1 }));
            },
            error: (error: DOMException) => {
              console.warn('[WebCodecsPlayer] Decoder error:', error);
              setDecoderMode('Canvas Fallback');
              reportStatus('Snapshot Fallback');
            },
          });

          decoder.configure({
            codec: 'avc1.64002A', // H.264 High Profile Level 4.2 (1080p 60FPS)
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
          });
          setDecoderMode('WebCodecs GPU');
        } catch (err) {
          console.warn('[WebCodecsPlayer] Failed to configure VideoDecoder, falling back:', err);
          setDecoderMode('Canvas Fallback');
          decoder = null;
        }
      } else {
        setDecoderMode('Canvas Fallback');
      }
    };

    initDecoder();

    // 3. Connect to the authenticated Teacher Console relay. A successful
    // handshake is only "Connecting"; Live is reported after a frame renders.
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const streamTarget = device.mac || device.ip;
    const teacherToken = AuthService.getToken() || '';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/stream/${encodeURIComponent(streamTarget)}?token=${encodeURIComponent(teacherToken)}`;

    const scheduleReconnect = () => {
      if (!isSubscribed || reconnectTimer !== null) return;
      const delay = Math.min(10_000, 1000 * (2 ** reconnectAttempt));
      reconnectAttempt = Math.min(reconnectAttempt + 1, 4);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, delay);
    };

    const handleStreamPacket = (buffer: ArrayBuffer) => {
      if (!isSubscribed) return;
      const bytes = new Uint8Array(buffer);
      packetCount++;
      totalBytes += bytes.length;
      lastPacketReceivedAt = performance.now();

      if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        const blob = new Blob([buffer], { type: 'image/jpeg' });
        createImageBitmap(blob).then((bitmap) => {
          if (!isSubscribed) {
            bitmap.close();
            return;
          }
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          renderCount++;
          renderedFrameRef.current = true;
          setLatency(Math.max(0, Math.round(performance.now() - lastPacketReceivedAt)));
          setDecoderMode('Canvas Fallback');
          if (statusRef.current !== 'Live 30FPS') reportStatus('Live 30FPS');
          setDebugStats((prev) => ({
            ...prev,
            packets: packetCount,
            kbReceived: Math.round(totalBytes / 1024),
            rendered: prev.rendered + 1,
            lastNalType: 'MJPEG Live (0xFFD8)',
          }));
        }).catch((err) => console.warn('[WebCodecsPlayer] MJPEG decode error:', err));
        return;
      }

      let isKeyFrame = false;
      let nalTypeName = 'Delta (1)';
      for (let i = 0; i < Math.min(bytes.length - 4, 128); i++) {
        if (bytes[i] === 0 && bytes[i + 1] === 0 && (bytes[i + 2] === 1 || (bytes[i + 2] === 0 && bytes[i + 3] === 1))) {
          const nalHeaderIndex = bytes[i + 2] === 1 ? i + 3 : i + 4;
          const nalType = bytes[nalHeaderIndex] & 0x1f;
          if (nalType === 5) {
            isKeyFrame = true;
            nalTypeName = 'IDR Keyframe (5)';
          } else if (nalType === 7) {
            isKeyFrame = true;
            nalTypeName = 'SPS (7)';
          } else if (nalType === 8) {
            isKeyFrame = true;
            nalTypeName = 'PPS (8)';
          }
          if (isKeyFrame) break;
        }
      }
      if (isKeyFrame) hasReceivedKeyFrame = true;

      setDebugStats((prev) => ({
        ...prev,
        packets: packetCount,
        kbReceived: Math.round(totalBytes / 1024),
        lastNalType: nalTypeName,
      }));

      if (hasReceivedKeyFrame && decoder && decoder.state === 'configured') {
        try {
          decoder.decode(new EncodedVideoChunk({
            type: isKeyFrame ? 'key' : 'delta',
            timestamp: performance.now() * 1000,
            data: buffer,
          }));
        } catch (decErr) {
          console.warn('[WebCodecsPlayer] Decode error:', decErr);
        }
      }
    };

    function connectWebSocket() {
      if (!isSubscribed) return;
      reportStatus(renderedFrameRef.current ? 'Snapshot Fallback' : 'Connecting');
      try {
        const nextWs = new WebSocket(wsUrl);
        ws = nextWs;
        nextWs.binaryType = 'arraybuffer';
        nextWs.onopen = () => {
          if (!isSubscribed || ws !== nextWs) return;
          reconnectAttempt = 0;
          reportStatus('Connecting');
        };
        nextWs.onmessage = (event) => {
          if (isSubscribed && ws === nextWs && event.data instanceof ArrayBuffer) {
            handleStreamPacket(event.data);
          }
        };
        nextWs.onerror = () => {
          if (isSubscribed && ws === nextWs && statusRef.current !== 'Live 30FPS') {
            reportStatus('Snapshot Fallback');
          }
        };
        nextWs.onclose = (event) => {
          if (!isSubscribed || ws !== nextWs) return;
          console.warn('[WebCodecsPlayer] WebSocket closed:', event.code, event.reason);
          ws = null;
          hasReceivedKeyFrame = false;
          reportStatus('Snapshot Fallback');
          scheduleReconnect();
        };
      } catch (err) {
        console.warn('[WebCodecsPlayer] WebSocket setup failed:', err);
        reportStatus('Snapshot Fallback');
        scheduleReconnect();
      }
    }

    // 4. Keep a real authenticated snapshot fallback updating while live
    // frames are unavailable; this also avoids a permanently frozen canvas.
    const isLive = () => statusRef.current === 'Live 30FPS';
    const drawFallbackSnapshot = async () => {
      if (!isSubscribed || isLive()) return;
      try {
        const response = await AuthService.fetchWithAuth(
          `/api/snapshot/${encodeURIComponent(streamTarget)}?t=${Date.now()}`
        );
        if (!response.ok) return;
        const bitmap = await createImageBitmap(await response.blob());
        if (!isSubscribed || isLive()) {
          bitmap.close();
          return;
        }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        renderedFrameRef.current = true;
        setDebugStats((prev) => ({ ...prev, lastNalType: 'Snapshot fallback' }));
        reportStatus('Snapshot Fallback');
      } catch {
        // The reconnect loop remains authoritative; avoid noisy 1 FPS logs.
      }
    };

    connectWebSocket();
    void drawFallbackSnapshot();
    const fallbackInterval = window.setInterval(() => void drawFallbackSnapshot(), 1000);

    return () => {
      isSubscribed = false;
      clearInterval(statsInterval);
      clearInterval(fallbackInterval);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
        ws = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      if (decoder && decoder.state !== 'closed') {
        try {
          decoder.close();
        } catch {}
      }
    };
  }, [device.id, device.mac, device.ip]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="w-full h-full object-contain bg-slate-950"
      />

      {/* OSD Performance & Real-Time Debug HUD (Controlled by showDebugHud, default OFF) */}
      {showDebugHud && (
        <div className="absolute top-3 left-3 px-3.5 py-2 rounded-lg bg-slate-950/90 border border-slate-700/80 text-xs font-mono flex flex-col space-y-1.5 text-slate-300 backdrop-blur shadow-2xl animate-in fade-in duration-150">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  streamStatus === 'Live 30FPS' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              <span className="text-emerald-400 font-bold">{fps} FPS</span>
            </div>
            <div>
              延遲: <span className="text-sky-400 font-bold">{latency > 0 ? `${latency} ms` : '<50 ms'}</span>
            </div>
            <div>
              硬解: <span className="text-purple-400 font-bold">{decoderMode}</span>
            </div>
            <div>
              狀態: <span className="text-slate-200 font-semibold">{streamStatus}</span>
            </div>
          </div>

          {/* Real-Time Diagnostic Telemetry */}
          <div className="text-[11px] text-slate-400 border-t border-slate-800 pt-1.5 flex items-center space-x-3">
            <span>
              接收包數: <b className="text-cyan-400">{debugStats.packets}</b> ({debugStats.kbReceived} KB)
            </span>
            <span>
              解碼幀數: <b className="text-emerald-400">{debugStats.rendered}</b>
            </span>
            <span>
              最新幀型: <b className="text-amber-300">{debugStats.lastNalType}</b>
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
