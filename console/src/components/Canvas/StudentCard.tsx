import React from 'react';
import { StudentDevice } from '../../types';
import { Monitor, Maximize2, RefreshCw, Cpu, Move, Edit2 } from 'lucide-react';

interface StudentCardProps {
  device: StudentDevice;
  isEditMode: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onDoubleClick: (device: StudentDevice) => void;
  onRefreshAuth: (device: StudentDevice) => void;
  onUnbind: (id: string) => void;
  onOpenSpecs?: (device: StudentDevice) => void;
  onEditSeat?: (device: StudentDevice) => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent, id: string) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, targetId: string) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}

export const StudentCard: React.FC<StudentCardProps> = ({
  device,
  isEditMode,
  onSelect,
  onDoubleClick,
  onRefreshAuth,
  onUnbind,
  onOpenSpecs,
  onEditSeat,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragging = false,
  isDragOver = false,
}) => {
  const getStatusBadge = () => {
    switch (device.status) {
      case 'online':
        return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" title="在線 (正常)" />;
      case 'degraded':
        return <span className="inline-block w-2 h-2 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" title="延遲偏高 / 封包遺失" />;
      case 'offline':
      default:
        return <span className="inline-block w-2 h-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" title="離線 / 連線逾時" />;
    }
  };

  const specs = device.specs;

  return (
    <div
      draggable={isEditMode}
      onDragStart={(e) => isEditMode && onDragStart?.(e, device.id)}
      onDragEnd={(e) => isEditMode && onDragEnd?.(e)}
      onDragOver={(e) => isEditMode && onDragOver?.(e, device.id)}
      onDragLeave={(e) => isEditMode && onDragLeave?.(e)}
      onDrop={(e) => isEditMode && onDrop?.(e, device.id)}
      onClick={(e) => onSelect(device.id, e.ctrlKey || e.metaKey)}
      onDoubleClick={() => (isEditMode ? onEditSeat?.(device) : onDoubleClick(device))}
      className={`group relative flex flex-col rounded-lg border bg-slate-900/90 backdrop-blur transition-all duration-150 overflow-hidden select-none ${
        isDragging
          ? 'opacity-40 scale-95 border-dashed border-sky-400'
          : isDragOver
          ? 'ring-2 ring-sky-400 border-sky-400 bg-sky-950/60 scale-105 shadow-xl shadow-sky-500/30'
          : device.selected
          ? 'border-sky-500 ring-2 ring-sky-500/50 shadow-lg shadow-sky-500/20'
          : 'border-slate-800 hover:border-slate-700 hover:shadow-md'
      } ${isEditMode ? 'cursor-grab active:cursor-grabbing hover:border-sky-500/60' : 'cursor-pointer'}`}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Header Info Bar */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-slate-950/70 border-b border-slate-800/80 text-xs">
        <div className="flex items-center space-x-1.5 font-semibold text-slate-200">
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-400 font-mono text-[11px]">
            {device.seatNo || '未分配'}
          </span>
          <span className="truncate max-w-[75px]" title={device.hostname}>
            {device.hostname}
          </span>
        </div>
        <div className="flex items-center space-x-1.5">
          {isEditMode ? (
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditSeat?.(device);
                }}
                className="p-1 rounded bg-sky-600/30 hover:bg-sky-500 text-sky-300 hover:text-white transition-colors"
                title="編輯此座位資訊"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              <span className="text-[10px] text-sky-400/80 flex items-center space-x-0.5 font-sans">
                <Move className="w-3 h-3" />
              </span>
            </div>
          ) : (
            <>
              {device.status !== 'offline' && (
                <span className="text-[10px] font-mono text-slate-400">
                  {device.latencyMs}ms
                </span>
              )}
              {getStatusBadge()}
            </>
          )}
        </div>
      </div>

      {/* 480x270 Realtime Preview Thumbnail */}
      <div className="relative flex-1 bg-slate-950 flex items-center justify-center overflow-hidden pointer-events-none">
        {device.thumbnailUrl ? (
          <img
            src={device.thumbnailUrl}
            alt={device.hostname}
            className="w-full h-full object-cover select-none pointer-events-none"
            loading="eager"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-600 space-y-1">
            <Monitor className="w-7 h-7 opacity-40" />
            <span className="text-[10px] font-mono">
              {device.status === 'offline' ? '無訊號 (未連線)' : '等待影像...'}
            </span>
          </div>
        )}

        {/* Hover Quick Actions in Monitor Mode */}
        {!isEditMode && (
          <div className="absolute inset-0 bg-slate-950/75 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-1.5 backdrop-blur-[2px] pointer-events-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDoubleClick(device);
              }}
              className="p-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white shadow"
              title="焦點 30 FPS 實時監看"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenSpecs?.(device);
              }}
              className="p-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white shadow"
              title="檢視電腦硬體狀態 (CPU/RAM/Disk)"
            >
              <Cpu className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefreshAuth(device);
              }}
              className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 shadow"
              title="重新配發 RAM 鑑權 Token"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Hover Quick Action in Edit Mode */}
        {isEditMode && (
          <div className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditSeat?.(device);
              }}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-lg shadow-sky-600/30"
              title="編輯座位資訊"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>編輯資訊</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer Info Bar with Live Hardware Meters */}
      <div className="flex items-center justify-between px-2 py-0.5 bg-slate-950/60 text-[10px] border-t border-slate-800/50 font-mono">
        {specs ? (
          <div className="flex items-center space-x-2 text-slate-400">
            <span className={specs.cpu.usage_percent > 80 ? 'text-rose-400' : 'text-slate-400'}>
              C:{specs.cpu.usage_percent.toFixed(0)}%
            </span>
            <span className={specs.ram.usage_percent > 85 ? 'text-amber-400' : 'text-slate-400'}>
              R:{specs.ram.usage_percent.toFixed(0)}%
            </span>
            <span className="text-slate-500 truncate max-w-[55px]" title={`磁碟可用 ${specs.disk.free_gb} GB`}>
              D:{specs.disk.free_gb}G
            </span>
          </div>
        ) : (
          <span className="truncate max-w-[85px] text-slate-400" title={device.username}>
            {device.username || '無登入者'}
          </span>
        )}
        <span className="text-slate-500 text-[9px]">{device.ip.split('.').slice(2).join('.')}</span>
      </div>
    </div>
  );
};
