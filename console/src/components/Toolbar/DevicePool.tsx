import React from 'react';
import { StudentDevice } from '../../types';
import { Monitor, ArrowRight, Sparkles, X } from 'lucide-react';

interface DevicePoolProps {
  isOpen: boolean;
  onClose: () => void;
  unassignedDevices: StudentDevice[];
  onAutoAssign: () => void;
}

export const DevicePool: React.FC<DevicePoolProps> = ({
  isOpen,
  onClose,
  unassignedDevices,
  onAutoAssign,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-14 bottom-0 w-80 bg-slate-900/95 border-l border-slate-800 p-4 shadow-2xl backdrop-blur z-40 flex flex-col">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h3 className="font-bold text-slate-100 text-sm">待分配設備池 (Device Pool)</h3>
          <p className="text-[11px] text-slate-400">上線 Beacon 探索但尚未排入座位之主機</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="py-3">
        <button
          onClick={onAutoAssign}
          className="w-full py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs flex items-center justify-center space-x-2 shadow"
        >
          <Sparkles className="w-4 h-4" />
          <span>依主機名 / IP 一鍵自動排序填入</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {unassignedDevices.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            目前無待分配設備 (全數已綁定座位)
          </div>
        ) : (
          unassignedDevices.map((d) => (
            <div
              key={d.id}
              className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-between"
            >
              <div className="flex items-center space-x-2">
                <Monitor className="w-4 h-4 text-slate-400" />
                <div>
                  <div className="font-semibold text-slate-200 text-xs">{d.hostname}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{d.ip}</div>
                </div>
              </div>
              <button
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="拖曳至畫布或自動分配"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
