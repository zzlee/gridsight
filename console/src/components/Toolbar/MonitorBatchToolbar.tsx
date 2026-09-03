import React from 'react';
import { StudentDevice } from '../../types';
import { Lock, Unlock, Globe, FolderUp, FolderDown, Power, X, CheckSquare } from 'lucide-react';

interface MonitorBatchToolbarProps {
  selectedSeats: StudentDevice[];
  onOpenLockModal: () => void;
  onBatchUnlock: () => void;
  onOpenAssignment?: () => void;
  onOpenShareUrl?: () => void;
  onOpenShareFile?: () => void;
  onOpenShutdown?: () => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  totalSeatsCount: number;
}

export const MonitorBatchToolbar: React.FC<MonitorBatchToolbarProps> = ({
  selectedSeats,
  onOpenLockModal,
  onBatchUnlock,
  onOpenAssignment,
  onOpenShareUrl,
  onOpenShareFile,
  onOpenShutdown,
  onClearSelection,
  onSelectAll,
  totalSeatsCount,
}) => {
  if (selectedSeats.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center space-x-2 px-4 py-2 bg-slate-900/95 border border-amber-500/40 rounded-2xl shadow-2xl shadow-amber-950/80 backdrop-blur-md text-sm select-none ring-1 ring-amber-400/20">
        {/* Selection Count Badge */}
        <div className="flex items-center space-x-2 pr-3 border-r border-slate-800">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
          </span>
          <span className="font-semibold text-amber-300 font-mono text-xs">
            已框選 {selectedSeats.length} 台學生機
          </span>
        </div>

        {/* Action: Batch Lock Screen */}
        <button
          onClick={onOpenLockModal}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/30 hover:border-transparent font-semibold text-xs transition-all shadow-sm group"
          title="鎖定所選學生的螢幕與鍵盤滑鼠"
        >
          <Lock className="w-3.5 h-3.5 text-amber-400 group-hover:text-white transition-colors" />
          <span>批次鎖定</span>
        </button>

        {/* Action: Batch Unlock */}
        <button
          onClick={onBatchUnlock}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-all"
          title="立即解除所選學生的螢幕鎖定"
        >
          <Unlock className="w-3.5 h-3.5 text-emerald-400" />
          <span>批次解鎖</span>
        </button>

        {/* Action: Collect Assignment */}
        {onOpenAssignment && (
          <button
            onClick={onOpenAssignment}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white border border-slate-700 font-medium text-xs transition-all"
            title="向所選學生發起收取作業"
          >
            <FolderDown className="w-3.5 h-3.5 text-emerald-400" />
            <span>收作業</span>
          </button>
        )}

        {/* Action: Share URL */}
        {onOpenShareUrl && (
          <button
            onClick={onOpenShareUrl}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white border border-slate-700 font-medium text-xs transition-all"
            title="分享網址給所選學生"
          >
            <Globe className="w-3.5 h-3.5 text-sky-400" />
            <span>分享網址</span>
          </button>
        )}

        {/* Action: Share File */}
        {onOpenShareFile && (
          <button
            onClick={onOpenShareFile}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-600 text-slate-300 hover:text-white border border-slate-700 font-medium text-xs transition-all"
            title="分享檔案給所選學生"
          >
            <FolderUp className="w-3.5 h-3.5 text-amber-400" />
            <span>分享檔案</span>
          </button>
        )}

        {/* Action: Shutdown */}
        {onOpenShutdown && (
          <button
            onClick={onOpenShutdown}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white border border-slate-700 font-medium text-xs transition-all"
            title="廣播關機所選學生機"
          >
            <Power className="w-3.5 h-3.5 text-rose-400" />
            <span>關機</span>
          </button>
        )}

        {/* Action: Select All */}
        {selectedSeats.length < totalSeatsCount && (
          <button
            onClick={onSelectAll}
            className="px-2 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-xs flex items-center space-x-1"
            title="全選所有座位 (Ctrl+A)"
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>全選</span>
          </button>
        )}

        {/* Action: Deselect */}
        <button
          onClick={onClearSelection}
          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-950/50 transition-colors"
          title="取消選取 (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
