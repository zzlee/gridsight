import React from 'react';
import { AppMode, ClassroomLayout } from '../../types';
import { TrafficStats } from '../../services/pollingManager';
import {
  Layers,
  Edit3,
  Eye,
  HardDrive,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sliders,
} from 'lucide-react';

interface TopNavProps {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  layout: ClassroomLayout;
  onOpenMatrixConfig: () => void;
  onOpenDevicePool: () => void;
  unassignedCount?: number;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  onResetView: () => void;
  onLock: () => void;
  onOpenChangePin: () => void;
  trafficStats?: TrafficStats | null;
}

export const TopNav: React.FC<TopNavProps> = ({
  mode,
  setMode,
  layout,
  onOpenMatrixConfig,
  onOpenDevicePool,
  unassignedCount = 0,
  zoom,
  setZoom,
  onResetView,
  onLock,
  onOpenChangePin,
  trafficStats,
}) => {
  const activeSeatCount = layout.seats.length;
  const cols = layout.cols;
  const rows = Math.max(1, layout.rows - 1);

  return (
    <header className="h-14 bg-slate-950 border-b border-slate-800 px-4 flex items-center justify-between z-30 select-none">
      {/* Brand Title & Classroom Title */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white shadow-md shadow-sky-600/30">
            GS
          </div>
          <div>
            <div className="font-bold text-slate-100 text-sm tracking-wide">GridSight</div>
            <div className="text-[10px] text-slate-400 font-medium">電腦教室螢幕即時監控系統</div>
          </div>
        </div>

        <div className="h-5 w-px bg-slate-800" />

        <div className="text-xs font-semibold text-slate-300 bg-slate-900 px-2.5 py-1 rounded border border-slate-800 flex items-center space-x-1.5">
          <span>{layout.name}</span>
          <span className="text-[10px] text-sky-400 font-mono">({activeSeatCount}席位)</span>
        </div>
      </div>

      {/* Central Mode Switcher & Tools & Network Traffic Telemetry */}
      <div className="flex items-center space-x-3">
        <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
          <button
            onClick={() => setMode('MONITOR')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              mode === 'MONITOR'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>監看模式</span>
          </button>
          <button
            onClick={() => setMode('EDIT_LAYOUT')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              mode === 'EDIT_LAYOUT'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>佈局編輯</span>
          </button>
        </div>

        {/* Real-time Network Traffic HUD (Monitor Mode Only) */}
        {mode === 'MONITOR' && trafficStats && (
          <div className="flex items-center space-x-3 px-3 py-1 bg-slate-900/90 border border-slate-800 rounded-lg text-xs font-mono shadow-inner">
            {/* Inbound Bandwidth Speed */}
            <div className="flex items-center space-x-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  trafficStats.bytesPerSec > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                }`}
              />
              <span className="text-slate-400 text-[11px]">流量:</span>
              <span className="text-emerald-400 font-bold">
                {trafficStats.bytesPerSec >= 1048576
                  ? `${(trafficStats.bytesPerSec / 1048576).toFixed(2)} MB/s`
                  : `${Math.round(trafficStats.bytesPerSec / 1024)} KB/s`}
              </span>
            </div>

            <div className="h-3.5 w-px bg-slate-800" />

            {/* Viewport Polled Devices */}
            <div className="flex items-center space-x-1">
              <span className="text-slate-400 text-[11px]">視口:</span>
              <span className="text-sky-400 font-semibold">
                {trafficStats.polledCount} / {trafficStats.onlineCount} 台
              </span>
            </div>

            <div className="h-3.5 w-px bg-slate-800" />

            {/* Cumulative Transferred Bytes */}
            <div className="flex items-center space-x-1 text-[11px] text-slate-400">
              <span>累積:</span>
              <span className="text-slate-300">
                {trafficStats.totalBytes >= 1073741824
                  ? `${(trafficStats.totalBytes / 1073741824).toFixed(2)} GB`
                  : `${(trafficStats.totalBytes / 1048576).toFixed(1)} MB`}
              </span>
            </div>
          </div>
        )}

        <div className="h-5 w-px bg-slate-800" />

        {/* Matrix Dimensions Button (X × Y Standard Matrix) */}
        <button
          onClick={onOpenMatrixConfig}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 hover:text-white"
          title="自訂 X × Y 矩陣尺寸"
        >
          <Sliders className="w-3.5 h-3.5 text-sky-400" />
          <span>矩陣尺寸 ({cols}×{rows})</span>
        </button>

        {/* Device Pool Button with unassigned badge */}
        <button
          onClick={onOpenDevicePool}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 hover:text-white relative"
          title="開啟待分配設備池"
        >
          <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
          <span>設備池</span>
          {unassignedCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-bold text-[10px]">
              {unassignedCount}
            </span>
          )}
        </button>

        {/* Zoom Controls */}
        <div className="flex items-center space-x-1 bg-slate-900 p-0.5 rounded border border-slate-800 text-slate-400">
          <button
            onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
            className="p-1 hover:text-slate-200"
            title="縮小"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-mono w-10 text-center text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
            className="p-1 hover:text-slate-200"
            title="放大"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onResetView}
            className="p-1 hover:text-slate-200"
            title="重置視角"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Right: Security PIN settings & Lock Console */}
      <div className="flex items-center space-x-2.5">
        <button
          onClick={onOpenChangePin}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors text-xs font-semibold"
          title="修改教師安全 PIN 碼"
        >
          <span>🔑</span>
          <span>PIN 碼設定</span>
        </button>

        <button
          onClick={onLock}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-xs font-semibold transition-all shadow-sm"
          title="離開座位鎖定控制台"
        >
          <span>🔒</span>
          <span>鎖定控制台</span>
        </button>
      </div>
    </header>
  );
};
