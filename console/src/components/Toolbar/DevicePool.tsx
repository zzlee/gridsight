import React, { useState } from 'react';
import { StudentDevice } from '../../types';
import { Monitor, ArrowRight, Sparkles, X, Inbox, Move } from 'lucide-react';

interface DevicePoolProps {
  isOpen: boolean;
  onClose: () => void;
  unassignedDevices: StudentDevice[];
  onAutoAssign: () => void;
  onReturnToPool?: (seatId: string) => void;
  onAssignToFirstAvailable?: (device: StudentDevice) => void;
}

export const DevicePool: React.FC<DevicePoolProps> = ({
  isOpen,
  onClose,
  unassignedDevices,
  onAutoAssign,
  onReturnToPool,
  onAssignToFirstAvailable,
}) => {
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);

  if (!isOpen) return null;

  const handleDragStart = (e: React.DragEvent, device: StudentDevice) => {
    e.dataTransfer.setData('text/plain', device.id);
    e.dataTransfer.setData('source', 'device-pool');
    e.dataTransfer.setData('application/json', JSON.stringify(device));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePanelDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (!isDropTargetActive) {
      setIsDropTargetActive(true);
    }
  };

  const handlePanelDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTargetActive(false);
  };

  const handlePanelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTargetActive(false);
    const sourceId = e.dataTransfer.getData('text/plain');
    if (sourceId && onReturnToPool) {
      onReturnToPool(sourceId);
    }
  };

  return (
    <div
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
      className={`fixed right-0 top-14 bottom-0 w-84 bg-slate-900/95 border-l border-slate-800 p-4 shadow-2xl backdrop-blur z-40 flex flex-col transition-colors select-none ${
        isDropTargetActive ? 'ring-2 ring-sky-400 bg-sky-950/70 border-sky-400' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h3 className="font-bold text-slate-100 text-sm flex items-center space-x-2">
            <Inbox className="w-4 h-4 text-sky-400" />
            <span>待分配設備池 ({unassignedDevices.length} 台)</span>
          </h3>
          <p className="text-[11px] text-slate-400">可自由拖入或拖出指派至任意坐標</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drag & Drop Receiver Target Area */}
      <div
        className={`my-3 p-3 rounded-lg border-2 border-dashed transition-all flex flex-col items-center justify-center text-center ${
          isDropTargetActive
            ? 'border-sky-400 bg-sky-500/20 text-sky-200 scale-105'
            : 'border-slate-800 bg-slate-950/40 text-slate-400'
        }`}
      >
        <Inbox className={`w-5 h-5 mb-1 ${isDropTargetActive ? 'text-sky-300 animate-bounce' : 'text-slate-500'}`} />
        <span className="text-xs font-medium">
          {isDropTargetActive ? '釋放以回歸待分配設備池' : '拖曳學生畫面至此以回歸設備池'}
        </span>
      </div>

      {/* Auto Assign Button */}
      {unassignedDevices.length > 0 && (
        <div className="mb-3">
          <button
            onClick={onAutoAssign}
            className="w-full py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow shadow-sky-600/30 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            <span>一鍵依序填入空白座位</span>
          </button>
        </div>
      )}

      {/* Device List (Draggable items) */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {unassignedDevices.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-xs">
            目前無待分配設備<br />
            （所有在線設備皆已排入座位）
          </div>
        ) : (
          unassignedDevices.map((d) => (
            <div
              key={d.id}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, d)}
              className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/80 hover:border-sky-500/80 hover:bg-slate-900 cursor-grab active:cursor-grabbing flex items-center justify-between transition-all group"
            >
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 rounded bg-slate-800 text-sky-400 group-hover:bg-sky-500/20">
                  <Monitor className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200 text-xs flex items-center space-x-1.5">
                    <span>{d.hostname}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm" title="在線" />
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">{d.ip}</div>
                </div>
              </div>
              <div className="flex items-center space-x-1">
                <span className="text-[10px] text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-0.5">
                  <Move className="w-3 h-3" />
                  <span>拖出</span>
                </span>
                {onAssignToFirstAvailable && (
                  <button
                    onClick={() => onAssignToFirstAvailable(d)}
                    className="p-1 rounded bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white transition-colors"
                    title="排入第一個空白座位"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
