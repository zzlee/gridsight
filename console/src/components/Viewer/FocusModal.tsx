import React, { useState, useRef, useEffect } from 'react';
import { StudentDevice } from '../../types';
import { WebCodecsPlayer, WebCodecsPlayerHandle } from './WebCodecsPlayer';
import { X, Maximize, Minimize, Camera, ShieldCheck, Cpu, MemoryStick, HardDrive, Info, CheckCircle, Activity } from 'lucide-react';

interface FocusModalProps {
  device: StudentDevice | null;
  onClose: () => void;
}

export const FocusModal: React.FC<FocusModalProps> = ({ device, onClose }) => {
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<WebCodecsPlayerHandle>(null);
  const [showSpecsHud, setShowSpecsHud] = useState(false); // Default OFF
  const [showDebugHud, setShowDebugHud] = useState(false); // Default OFF
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync fullscreen state with browser events (e.g. Esc key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (!device) return null;

  const specs = device.specs;

  const handleToggleFullscreen = async () => {
    if (!modalContainerRef.current) return;
    if (!document.fullscreenElement) {
      try {
        await modalContainerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch (err) {
        console.warn('[FocusModal] Fullscreen error:', err);
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch (err) {
        console.warn('[FocusModal] Exit fullscreen error:', err);
      }
    }
  };

  const handleTakeSnapshot = async () => {
    let dataUrl: string | null = null;

    // 1. Try capturing exact current frame from WebCodecs canvas
    if (playerRef.current) {
      dataUrl = playerRef.current.captureSnapshot();
    }

    // 2. Fallback to thumbnail URL if canvas was blank
    if (!dataUrl && device.thumbnailUrl) {
      dataUrl = device.thumbnailUrl;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `GridSight_${device.seatNo || device.hostname}_${timestamp}.png`;

    if (dataUrl) {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setToastMessage(`📸 截圖已儲存：${filename}`);
      setTimeout(() => setToastMessage(null), 3000);
    } else {
      // 3. Fallback: Fetch direct snapshot via backend API
      try {
        const resp = await fetch(`/api/snapshot/${encodeURIComponent(device.mac || device.ip)}?t=${Date.now()}`);
        if (resp.ok) {
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(blobUrl);

          setToastMessage(`📸 截圖已儲存：${filename}`);
          setTimeout(() => setToastMessage(null), 3000);
        }
      } catch (err) {
        console.warn('[FocusModal] Snapshot download failed:', err);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div
        ref={modalContainerRef}
        className={`relative w-full bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all ${
          isFullscreen ? 'h-full max-w-none rounded-none border-none' : 'max-w-5xl h-[85vh]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-400 font-mono font-bold text-sm">
              座號 {device.seatNo || '未分配'}
            </span>
            <span className="font-bold text-slate-100 text-base">{device.hostname}</span>
            <span className="text-xs text-slate-400 font-mono">({device.ip})</span>
            <div className="flex items-center space-x-1 text-emerald-400 text-xs px-2 py-0.5 bg-emerald-500/10 rounded border border-emerald-500/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Token 鑑權生效</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {/* Toggle Stream Diagnostic HUD (Default OFF) */}
            <button
              onClick={() => setShowDebugHud(!showDebugHud)}
              className={`p-1.5 rounded-lg border transition-colors ${
                showDebugHud
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="切換左上角串流除錯資訊 (FPS / 延遲 / 幀型)"
            >
              <Activity className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSpecsHud(!showSpecsHud)}
              className={`p-1.5 rounded-lg border transition-colors ${
                showSpecsHud
                  ? 'bg-sky-600/30 border-sky-500 text-sky-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="切換硬體狀態 HUD 浮層"
            >
              <Info className="w-4 h-4" />
            </button>
            <button
              onClick={handleTakeSnapshot}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white transition-colors"
              title="畫面截圖存檔 (下載 PNG)"
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              onClick={handleToggleFullscreen}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title={isFullscreen ? '退出全螢幕' : '全螢幕 (F11)'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 transition-colors"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Canvas Area */}
        <div className="flex-1 bg-black overflow-hidden relative">
          <WebCodecsPlayer ref={playerRef} device={device} showDebugHud={showDebugHud} />

          {/* Toast Notification */}
          {toastMessage && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-sky-950/90 border border-sky-500/50 text-sky-200 text-xs px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md flex items-center space-x-2 animate-in fade-in slide-in-from-top-2 duration-150">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* OSD Hardware Status Floating Overlay */}
          {showSpecsHud && specs && (
            <div className="absolute top-3 right-3 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 rounded-lg p-3 text-xs space-y-2 shadow-xl pointer-events-none max-w-xs animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-slate-300 border-b border-slate-800 pb-1 font-semibold">
                <span className="text-sky-400">學生端硬體即時監控</span>
                <span className="font-mono text-[11px] text-slate-400">{specs.os || 'Windows'}</span>
              </div>
              <div className="space-y-1.5 font-mono">
                {/* CPU */}
                <div className="flex items-center justify-between space-x-3">
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <Cpu className="w-3.5 h-3.5 text-sky-400" />
                    <span className="truncate max-w-[120px]" title={specs.cpu.model}>{specs.cpu.model}</span>
                  </div>
                  <span className={`font-bold ${specs.cpu.usage_percent > 80 ? 'text-rose-400' : 'text-slate-200'}`}>
                    {specs.cpu.usage_percent.toFixed(1)}%
                  </span>
                </div>

                {/* RAM */}
                <div className="flex items-center justify-between space-x-3">
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <MemoryStick className="w-3.5 h-3.5 text-emerald-400" />
                    <span>RAM ({Math.round(specs.ram.total_mb / 1024)}GB)</span>
                  </div>
                  <span className={`font-bold ${specs.ram.usage_percent > 85 ? 'text-amber-400' : 'text-slate-200'}`}>
                    {specs.ram.usage_percent.toFixed(1)}%
                  </span>
                </div>

                {/* Disk */}
                <div className="flex items-center justify-between space-x-3">
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                    <span>磁碟 (可用 {specs.disk.free_gb}G)</span>
                  </div>
                  <span className="font-bold text-slate-200">
                    {specs.disk.usage_percent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>登入使用者: <span className="text-slate-200 font-medium">{device.username || 'Student'}</span> | MAC: <span className="font-mono">{device.mac}</span></div>
          <div className="text-sky-400 font-medium">按需 OpenH264 WebSocket 串流中 (單機約 2~4 Mbps)</div>
        </div>
      </div>
    </div>
  );
};
