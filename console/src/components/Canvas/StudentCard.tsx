import React from 'react';
import { StudentDevice } from '../../types';
import { Monitor, Maximize2, Cpu, Move, Edit2, Lock, Unlock, Radio, RotateCcw } from 'lucide-react';

interface StudentCardProps {
  device: StudentDevice;
  isEditMode: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onDoubleClick: (device: StudentDevice) => void;
  onUnbind: (id: string) => void;
  onOpenSpecs?: (device: StudentDevice) => void;
  onEditSeat?: (device: StudentDevice) => void;
  onShowcase?: (device: StudentDevice) => void;
  onToggleLock?: (device: StudentDevice) => void;
  onPromptRollCall?: (device: StudentDevice) => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent, id: string) => void;
  onDragLeave?: (e: React.DragEvent, id: string) => void;
  onDrop?: (e: React.DragEvent, targetId: string) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}

const StudentCardComponent: React.FC<StudentCardProps> = ({
  device,
  isEditMode,
  onSelect,
  onDoubleClick,
  onOpenSpecs,
  onEditSeat,
  onShowcase,
  onToggleLock,
  onPromptRollCall,
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

  return (
    <div
      draggable={isEditMode}
      onDragStart={(e) => isEditMode && onDragStart?.(e, device.id)}
      onDragEnd={(e) => isEditMode && onDragEnd?.(e)}
      onDragOver={(e) => isEditMode && onDragOver?.(e, device.id)}
      onDragLeave={(e) => isEditMode && onDragLeave?.(e, device.id)}
      onDrop={(e) => isEditMode && onDrop?.(e, device.id)}
      onClick={(e) => onSelect(device.id, e.ctrlKey || e.metaKey)}
      onDoubleClick={() => (isEditMode ? onEditSeat?.(device) : onDoubleClick(device))}
      className={`group relative flex flex-col rounded-lg border bg-slate-900/90 backdrop-blur transition-all duration-150 overflow-hidden select-none card-containment ${
        isDragging
          ? 'opacity-40 scale-95 border-dashed border-sky-400'
          : isDragOver
          ? 'ring-2 ring-sky-400 border-sky-400 bg-sky-950/60 scale-105 shadow-xl shadow-sky-500/30'
          : device.selected
          ? 'border-sky-500 ring-2 ring-sky-500/50 shadow-lg shadow-sky-500/20'
          : device.isLocked
          ? 'border-amber-500/80 ring-2 ring-amber-500/50 shadow-lg shadow-amber-950/70 bg-amber-950/10'
          : 'border-slate-800 hover:border-slate-700 hover:shadow-md'
      } ${isEditMode ? 'cursor-grab active:cursor-grabbing hover:border-sky-500/60' : 'cursor-pointer'}`}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Header Info Bar: Seat No + Student ID + Status */}
      <div className={`flex items-center justify-between px-2 py-1 border-b text-xs transition-colors ${
        device.isLocked
          ? 'bg-amber-950/70 border-amber-800/80'
          : 'bg-slate-950/70 border-slate-800/80'
      }`}>
        <div className="flex items-center space-x-1.5 font-semibold">
          <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${
            device.isLocked
              ? 'bg-amber-600 text-white font-bold'
              : 'bg-slate-800 text-sky-400'
          }`}>
            {device.seatNo || '未分配'}
          </span>
          {device.studentId ? (
            <span
              className="px-1.5 py-0.5 rounded font-mono font-bold text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
              title={`學號: ${device.studentId}`}
            >
              🎓 {device.studentId}
            </span>
          ) : (
            <span className="text-[11px] font-mono text-slate-500 italic px-1">
              未簽到
            </span>
          )}
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
              {device.isLocked && (
                <span className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-bold flex items-center gap-0.5" title="螢幕與鍵鼠已被鎖定">
                  <Lock className="w-2.5 h-2.5" /> 鎖定
                </span>
              )}
              {getStatusBadge()}
            </>
          )}
        </div>
      </div>

      {/* Realtime Preview Thumbnail (Takes maximum available space) */}
      <div className="relative flex-1 bg-slate-950 flex items-center justify-center overflow-hidden pointer-events-none">
        {device.thumbnailUrl ? (
          <img
            src={device.thumbnailUrl}
            alt={device.studentId || device.hostname}
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
            {onPromptRollCall && device.status !== 'offline' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPromptRollCall(device);
                }}
                className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-transform active:scale-95"
                title="🔄 要求此學生重填學號"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
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
            {onShowcase && device.status !== 'offline' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onShowcase(device);
                }}
                className="p-1.5 rounded-md bg-purple-600 hover:bg-purple-500 text-white shadow transition-transform active:scale-95"
                title="📡 轉播此學生畫面給全班"
              >
                <Radio className="w-3.5 h-3.5" />
              </button>
            )}
            {onToggleLock && device.status !== 'offline' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLock(device);
                }}
                className={`p-1.5 rounded-md text-white shadow transition-transform active:scale-95 ${
                  device.isLocked ? 'bg-amber-600 hover:bg-amber-500' : 'bg-slate-700 hover:bg-slate-600'
                }`}
                title={device.isLocked ? '🔓 解除此學生機鎖定' : '🔒 鎖定此機螢幕與鍵鼠'}
              >
                {device.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              </button>
            )}
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
    </div>
  );
};

export const StudentCard = React.memo(StudentCardComponent, (prevProps, nextProps) => {
  if (
    prevProps.isEditMode !== nextProps.isEditMode ||
    prevProps.isDragging !== nextProps.isDragging ||
    prevProps.isDragOver !== nextProps.isDragOver
  ) {
    return false;
  }

  const prev = prevProps.device;
  const next = nextProps.device;

  return (
    prev.id === next.id &&
    prev.seatNo === next.seatNo &&
    prev.studentId === next.studentId &&
    prev.status === next.status &&
    prev.isLocked === next.isLocked &&
    prev.selected === next.selected &&
    prev.thumbnailUrl === next.thumbnailUrl
  );
});

