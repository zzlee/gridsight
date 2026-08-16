import React from 'react';
import { StudentDevice } from '../../types';
import { Monitor, Maximize2, RefreshCw, Unlink } from 'lucide-react';

interface StudentCardProps {
  device: StudentDevice;
  isEditMode: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onDoubleClick: (device: StudentDevice) => void;
  onRefreshAuth: (device: StudentDevice) => void;
  onUnbind: (id: string) => void;
}

export const StudentCard: React.FC<StudentCardProps> = ({
  device,
  isEditMode,
  onSelect,
  onDoubleClick,
  onRefreshAuth,
  onUnbind,
}) => {
  const getStatusBadge = () => {
    switch (device.status) {
      case 'online':
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" title="在線 (正常)" />;
      case 'degraded':
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" title="延遲偏高 / 封包遺失" />;
      case 'offline':
      default:
        return <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" title="離線 / 連線逾時" />;
    }
  };

  return (
    <div
      onClick={(e) => onSelect(device.id, e.ctrlKey || e.metaKey)}
      onDoubleClick={() => !isEditMode && onDoubleClick(device)}
      className={`group relative flex flex-col rounded-lg border bg-slate-900/90 backdrop-blur transition-all duration-150 overflow-hidden ${
        device.selected
          ? 'border-sky-500 ring-2 ring-sky-500/50 shadow-lg shadow-sky-500/20'
          : 'border-slate-800 hover:border-slate-700 hover:shadow-md'
      } ${isEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Header Info Bar */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-950/60 border-b border-slate-800/80 text-xs">
        <div className="flex items-center space-x-1.5 font-semibold text-slate-200">
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-400 font-mono text-[11px]">
            {device.seatNo || '未分配'}
          </span>
          <span className="truncate max-w-[80px]" title={device.hostname}>
            {device.hostname}
          </span>
        </div>
        <div className="flex items-center space-x-1.5">
          {device.status !== 'offline' && (
            <span className="text-[10px] font-mono text-slate-400">
              {device.latencyMs}ms
            </span>
          )}
          {getStatusBadge()}
        </div>
      </div>

      {/* 480x270 Realtime Preview Thumbnail */}
      <div className="relative flex-1 bg-slate-950 flex items-center justify-center overflow-hidden">
        {device.thumbnailUrl ? (
          <img
            src={device.thumbnailUrl}
            alt={device.hostname}
            className="w-full h-full object-cover select-none pointer-events-none"
            loading="eager"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-600 space-y-1">
            <Monitor className="w-8 h-8 opacity-40" />
            <span className="text-[11px] font-mono">
              {device.status === 'offline' ? '無訊號 (未連線)' : '等待影像輪詢...'}
            </span>
          </div>
        )}

        {/* Hover Quick Actions */}
        {!isEditMode && (
          <div className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 backdrop-blur-[2px]">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDoubleClick(device);
              }}
              className="p-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white shadow"
              title="焦點 30 FPS 實時監看"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefreshAuth(device);
              }}
              className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 shadow"
              title="重新配發 RAM 鑑權 Token"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Footer Info Bar */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-slate-950/40 text-[10px] text-slate-400 border-t border-slate-800/40">
        <span className="truncate max-w-[90px]" title={device.username}>
          {device.username || '無登入者'}
        </span>
        <span className="font-mono text-slate-500">{device.ip}</span>
      </div>
    </div>
  );
};
