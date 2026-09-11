import React, { useState, useEffect, useRef } from 'react';
import { AuthService } from '../../services/authService';
import { StudentDevice } from '../../types';
import {
  Timer,
  X,
  Radio,
  Square,
  RefreshCw,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
} from 'lucide-react';

interface BroadcastBenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: StudentDevice[];
  onBroadcastStateChange?: (active: boolean) => void;
}

export const BroadcastBenchmarkModal: React.FC<BroadcastBenchmarkModalProps> = ({
  isOpen,
  onClose,
  devices,
  onBroadcastStateChange,
}) => {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [currentTimeText, setCurrentTimeText] = useState<string>('00:00:00.000');
  const [currentBlockIndex, setCurrentBlockIndex] = useState<number>(0);
  const [isBroadcasting, setIsBroadcasting] = useState<boolean>(false);
  const [isProcessingBroadcast, setIsProcessingBroadcast] = useState<boolean>(false);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState<boolean>(false);
  const [customThumbUrl, setCustomThumbUrl] = useState<string | null>(null);
  const [snapshotTimestamp, setSnapshotTimestamp] = useState<string>('無');
  const [agentCaptureTimestamp, setAgentCaptureTimestamp] = useState<string>('無');
  const rafRef = useRef<number | null>(null);

  // Online devices available for monitoring
  const onlineDevices = devices.filter((d) => d.status === 'online' && d.ip);

  // Default to first online device
  useEffect(() => {
    if (!selectedDeviceId && onlineDevices.length > 0) {
      setSelectedDeviceId(onlineDevices[0].id);
    }
  }, [onlineDevices, selectedDeviceId]);

  // Sync broadcast status with backend
  const checkBroadcastStatus = async () => {
    try {
      const resp = await AuthService.fetchWithAuth('/api/broadcast/status');
      if (resp.ok) {
        const data = await resp.json();
        const active = !!data.active;
        setIsBroadcasting(active);
        onBroadcastStateChange?.(active);
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      checkBroadcastStatus();
      const timer = setInterval(checkBroadcastStatus, 2500);
      return () => clearInterval(timer);
    }
  }, [isOpen]);

  // High-precision reference clock driven by requestAnimationFrame (60 FPS)
  useEffect(() => {
    if (!isOpen) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const updateClock = () => {
      const now = new Date();
      const pad = (n: number, z = 2) => String(n).padStart(z, '0');
      const ms = now.getMilliseconds();
      const text = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(ms, 3)}`;
      setCurrentTimeText(text);

      // 4-phase color block cycling every 250ms (1000ms full loop)
      const blockIdx = Math.floor((ms % 1000) / 250);
      setCurrentBlockIndex(blockIdx);

      rafRef.current = requestAnimationFrame(updateClock);
    };

    rafRef.current = requestAnimationFrame(updateClock);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const targetDevice = onlineDevices.find((d) => d.id === selectedDeviceId) || onlineDevices[0];

  const handleBroadcastToggle = async () => {
    setIsProcessingBroadcast(true);
    try {
      if (isBroadcasting) {
        const resp = await AuthService.fetchWithAuth('/api/broadcast/stop', { method: 'POST' });
        if (resp.ok) {
          setIsBroadcasting(false);
          onBroadcastStateChange?.(false);
        }
      } else {
        const resp = await AuthService.fetchWithAuth('/api/broadcast/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quality: 'high',
            fps: 30,
            bitrateKbps: 8000,
          }),
        });
        if (resp.ok) {
          setIsBroadcasting(true);
          onBroadcastStateChange?.(true);
        }
      }
    } finally {
      setIsProcessingBroadcast(false);
    }
  };

  // Immediate manual snapshot fetch for the selected student device
  const handleManualRefreshSnapshot = async () => {
    if (!targetDevice) return;
    setRefreshingSnapshot(true);
    try {
      const targetId = targetDevice.mac || targetDevice.ip;
      const resp = await AuthService.fetchWithAuth(`/api/snapshot/${encodeURIComponent(targetId)}?t=${Date.now()}`);
      if (resp.ok) {
        const captureTimeHeader = resp.headers.get('x-capture-time');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        setCustomThumbUrl(url);
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        setSnapshotTimestamp(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`);

        if (captureTimeHeader) {
          const capTimeMs = parseInt(captureTimeHeader, 10);
          if (!isNaN(capTimeMs)) {
            const capDate = new Date(capTimeMs);
            setAgentCaptureTimestamp(`${pad(capDate.getHours())}:${pad(capDate.getMinutes())}:${pad(capDate.getSeconds())}.${String(capDate.getMilliseconds()).padStart(3, '0')}`);
          } else {
            setAgentCaptureTimestamp('無法解析');
          }
        } else {
          setAgentCaptureTimestamp('未提供');
        }
      }
    } catch {
    } finally {
      setRefreshingSnapshot(false);
    }
  };

  const blockColors = [
    { name: '紅 (Phase 1: 0~250ms)', bg: 'bg-rose-600', text: 'text-rose-100', border: 'border-rose-400' },
    { name: '綠 (Phase 2: 250~500ms)', bg: 'bg-emerald-600', text: 'text-emerald-100', border: 'border-emerald-400' },
    { name: '藍 (Phase 3: 500~750ms)', bg: 'bg-sky-600', text: 'text-sky-100', border: 'border-sky-400' },
    { name: '黃 (Phase 4: 750~1000ms)', bg: 'bg-amber-500', text: 'text-amber-950', border: 'border-amber-300' },
  ];

  const currentThumb = customThumbUrl || targetDevice?.thumbnailUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Timer className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                廣播延遲校正與端到端量測工具 (Broadcast Latency Benchmark)
              </h2>
              <p className="text-xs text-slate-400">
                透過「基準毫秒碼錶」與「學生機畫面閉環回傳」，以視覺同屏精確量測端到端（Glass-to-Glass）延遲
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Top Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
            <div className="flex items-center space-x-3">
              <button
                onClick={handleBroadcastToggle}
                disabled={isProcessingBroadcast}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 ${
                  isBroadcasting
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                }`}
              >
                {isBroadcasting ? (
                  <>
                    <Square className="w-4 h-4 fill-current" />
                    <span>停止全班廣播</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-4 h-4 animate-pulse" />
                    <span>啟動全班測試廣播 (RTP Multicast)</span>
                  </>
                )}
              </button>

              <div className="flex items-center space-x-2 text-xs text-slate-400">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full animate-ping"
                  style={{ backgroundColor: isBroadcasting ? '#10b981' : '#64748b' }}
                />
                <span>
                  廣播狀態:{' '}
                  <strong className={isBroadcasting ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                    {isBroadcasting ? '廣播進行中' : '已停止'}
                  </strong>
                </span>
              </div>
            </div>

            {/* Target Student Device Picker */}
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-400 font-medium">觀測學生機:</span>
              <select
                value={targetDevice?.id || ''}
                onChange={(e) => {
                  setSelectedDeviceId(e.target.value);
                  setCustomThumbUrl(null);
                }}
                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-500"
              >
                {onlineDevices.length === 0 && <option value="">無在線學生機</option>}
                {onlineDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.seatNo ? `[${d.seatNo}號] ` : ''}{d.hostname} ({d.ip})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Benchmark Split View */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Panel: High Precision Reference Clock */}
            <div className="rounded-xl bg-slate-950 border border-sky-500/30 p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 px-3 py-1 bg-sky-900/60 border-b border-l border-sky-500/40 rounded-bl-lg text-[10px] font-mono text-sky-300 font-bold">
                基準發送端 (Teacher Clock)
              </div>

              <div>
                <div className="flex items-center space-x-2 text-xs text-sky-400 font-bold mb-3">
                  <Clock className="w-4 h-4" />
                  <span>本機即時時間戳 (基準時間)</span>
                </div>

                {/* Big Clock Display */}
                <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 text-center shadow-inner my-2">
                  <div className="text-4xl sm:text-5xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-teal-300 to-emerald-400 tracking-wider">
                    {currentTimeText}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-2">
                    Unix Timestamp: {Date.now()} ms
                  </div>
                </div>

                {/* Phase Color Blocks (250ms each) */}
                <div className="mt-4 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                    <span>250ms 循環色塊 (快速目測輔助)</span>
                    <span className="text-sky-400 font-mono">Phase {currentBlockIndex + 1}/4</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {blockColors.map((b, idx) => {
                      const isActive = idx === currentBlockIndex;
                      return (
                        <div
                          key={idx}
                          className={`h-12 rounded-lg flex flex-col items-center justify-center transition-all ${
                            isActive
                              ? `${b.bg} ${b.text} ${b.border} border-2 shadow-lg scale-105 font-black`
                              : 'bg-slate-900/60 text-slate-600 border border-slate-800/80 font-normal'
                          }`}
                        >
                          <span className="text-sm">{idx + 1}</span>
                          <span className="text-[9px]">{idx * 250}ms</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Instructions */}
              <div className="mt-5 p-3 rounded-lg bg-slate-900/50 border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
                💡 <strong>測試原理</strong>：啟動廣播後，右側將即時顯示學生機螢幕拍到的這組碼錶與色塊。直接以<strong>「左側時間 - 右側畫面拍到的時間」</strong>，即為真實的端到端延遲！
              </div>
            </div>

            {/* Right Panel: Student Screen Feedback (Closed-Loop) */}
            <div className="rounded-xl bg-slate-950 border border-emerald-500/30 p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 px-3 py-1 bg-emerald-900/60 border-b border-l border-emerald-500/40 rounded-bl-lg text-[10px] font-mono text-emerald-300 font-bold">
                學生接收回傳 (Agent Feedback)
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-bold mb-3">
                  <div className="flex items-center space-x-2 text-emerald-400">
                    <Monitor className="w-4 h-4" />
                    <span>學生螢幕實況截圖 ({targetDevice?.hostname || '未選定'})</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleManualRefreshSnapshot}
                      disabled={refreshingSnapshot || !targetDevice}
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[10px] transition-colors"
                      title="手動立即單擊拉取該學生機最新畫面"
                    >
                      <RefreshCw className={`w-3 h-3 ${refreshingSnapshot ? 'animate-spin text-sky-400' : ''}`} />
                      <span>立即截圖</span>
                    </button>
                    {targetDevice && (
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        RTT: {targetDevice.latencyMs || 0}ms
                      </span>
                    )}
                  </div>
                </div>

                {/* Thumbnail Preview Window */}
                <div className="relative aspect-video rounded-xl bg-slate-900 border border-slate-800 overflow-hidden flex items-center justify-center group shadow-inner">
                  {currentThumb ? (
                    <img
                      src={currentThumb}
                      alt={targetDevice?.hostname}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-center p-6 text-slate-500 text-xs">
                      <Monitor className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <div>尚未收到該學生機之最新截圖</div>
                      <div className="text-[10px] text-slate-600 mt-1">請確認學生端 gs-agent 是否在線執行</div>
                    </div>
                  )}

                  {/* Overlay Tag */}
                  {isBroadcasting && (
                    <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-slate-950/80 backdrop-blur-sm border border-slate-800 text-[10px] font-mono text-emerald-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      <span>即時快照回傳中</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Status footer for student */}
              <div className="mt-4 p-3 rounded-lg bg-slate-900/50 border border-slate-800/80 text-[11px] text-slate-300 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">電腦名稱:</span>
                  <span className="font-mono">{targetDevice?.hostname || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">IP 位址:</span>
                  <span className="font-mono">{targetDevice?.ip || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">本機接收時間:</span>
                  <span className="font-mono text-slate-400">{snapshotTimestamp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-bold text-sky-300">學生端截圖瞬間:</span>
                  <span className="font-mono text-sky-300 font-bold">{agentCaptureTimestamp}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/40 text-xs">
          <div className="text-slate-400 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>建議量測標準：端到端延遲若在 <strong>300ms 以內</strong>，師生操作即具備絕佳流暢感。</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            關閉視窗
          </button>
        </div>
      </div>
    </div>
  );
};
