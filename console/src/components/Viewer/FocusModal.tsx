import React, { useState } from 'react';
import { StudentDevice } from '../../types';
import { WebCodecsPlayer } from './WebCodecsPlayer';
import { X, Maximize, Camera, ShieldCheck, Cpu, MemoryStick, HardDrive, Info } from 'lucide-react';

interface FocusModalProps {
  device: StudentDevice | null;
  onClose: () => void;
}

export const FocusModal: React.FC<FocusModalProps> = ({ device, onClose }) => {
  const [showSpecsHud, setShowSpecsHud] = useState(true);
  if (!device) return null;

  const specs = device.specs;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-5xl h-[85vh] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
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
            <button className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="畫面截圖存檔">
              <Camera className="w-4 h-4" />
            </button>
            <button className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="全螢幕">
              <Maximize className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Canvas Area */}
        <div className="flex-1 bg-black overflow-hidden relative">
          <WebCodecsPlayer device={device} />

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
