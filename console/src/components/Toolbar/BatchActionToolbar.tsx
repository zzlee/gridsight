import React from 'react';
import { StudentDevice } from '../../types';
import { Inbox, Hash, Edit3, X, CheckSquare, Sparkles } from 'lucide-react';

interface BatchActionToolbarProps {
  selectedSeats: StudentDevice[];
  onReturnToPool: (ids: string[]) => void;
  onOpenBatchEdit: () => void;
  onAutoRenumber: () => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  totalSeatsCount: number;
}

export const BatchActionToolbar: React.FC<BatchActionToolbarProps> = ({
  selectedSeats,
  onReturnToPool,
  onOpenBatchEdit,
  onAutoRenumber,
  onClearSelection,
  onSelectAll,
  totalSeatsCount,
}) => {
  if (selectedSeats.length === 0) return null;

  const handleBatchReturn = () => {
    const ids = selectedSeats.map((s) => s.id);
    onReturnToPool(ids);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center space-x-2 px-4 py-2.5 bg-slate-900/95 border border-sky-500/40 rounded-2xl shadow-2xl shadow-sky-950/80 backdrop-blur-md text-sm select-none ring-1 ring-sky-400/20">
        {/* Selection Count Badge */}
        <div className="flex items-center space-x-2 pr-3 border-r border-slate-800">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
          </span>
          <span className="font-semibold text-sky-300 font-mono">
            已選取 {selectedSeats.length} 個座位
          </span>
        </div>

        {/* Action: Return to Pool */}
        <button
          onClick={handleBatchReturn}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600 text-sky-300 hover:text-white border border-sky-500/30 hover:border-transparent font-medium transition-all shadow-sm group"
          title="將選取的所有座位設備回歸待分配設備池"
        >
          <Inbox className="w-4 h-4 text-sky-400 group-hover:text-white transition-colors" />
          <span>回歸設備池</span>
        </button>

        {/* Action: Auto Renumber */}
        <button
          onClick={onAutoRenumber}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition-all"
          title="依網格行列座標自動重編座號 (例如 A1, A2...)"
        >
          <Hash className="w-4 h-4 text-amber-400" />
          <span>重編座號</span>
        </button>

        {/* Action: Batch Edit Modal */}
        <button
          onClick={onOpenBatchEdit}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition-all"
          title="開啟批次編輯視窗"
        >
          <Edit3 className="w-4 h-4 text-emerald-400" />
          <span>批次編輯</span>
        </button>

        {/* Action: Select All / Invert */}
        {selectedSeats.length < totalSeatsCount && (
          <button
            onClick={onSelectAll}
            className="px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-xs flex items-center space-x-1"
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
