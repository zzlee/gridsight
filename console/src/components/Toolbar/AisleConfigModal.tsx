import React, { useState } from 'react';
import { ClassroomLayout, GridAisle } from '../../types';
import { X, Save, Footprints, Plus, Trash2, Columns, Rows, Check } from 'lucide-react';

interface AisleConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  layout: ClassroomLayout;
  onSaveAisles: (aisles: GridAisle[]) => void;
}

export const AisleConfigModal: React.FC<AisleConfigModalProps> = ({
  isOpen,
  onClose,
  layout,
  onSaveAisles,
}) => {
  const [aisles, setAisles] = useState<GridAisle[]>(() => layout.aisles || []);

  if (!isOpen) return null;

  const totalCols = layout.cols;
  const totalRows = layout.rows;

  // Toggle vertical aisle after column colIdx (0-indexed)
  const handleToggleVertical = (colIdx: number) => {
    setAisles((prev) => {
      const exists = prev.some((a) => a.type === 'vertical' && a.index === colIdx);
      if (exists) {
        return prev.filter((a) => !(a.type === 'vertical' && a.index === colIdx));
      } else {
        const newAisle: GridAisle = {
          id: `aisle-v-${colIdx}-${Date.now()}`,
          type: 'vertical',
          index: colIdx,
          label: `走道 (第 ${colIdx + 1} 與 ${colIdx + 2} 欄之間)`,
        };
        return [...prev, newAisle];
      }
    });
  };

  // Toggle horizontal aisle after row rowIdx (0-indexed)
  const handleToggleHorizontal = (rowIdx: number) => {
    setAisles((prev) => {
      const exists = prev.some((a) => a.type === 'horizontal' && a.index === rowIdx);
      if (exists) {
        return prev.filter((a) => !(a.type === 'horizontal' && a.index === rowIdx));
      } else {
        const rowLabelA = String.fromCharCode(65 + (rowIdx % 26));
        const rowLabelB = String.fromCharCode(65 + ((rowIdx + 1) % 26));
        const newAisle: GridAisle = {
          id: `aisle-h-${rowIdx}-${Date.now()}`,
          type: 'horizontal',
          index: rowIdx,
          label: `橫向走道 (${rowLabelA} 排 與 ${rowLabelB} 排之間)`,
        };
        return [...prev, newAisle];
      }
    });
  };

  const handleSave = () => {
    onSaveAisles(aisles);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Footprints className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>教室走道劃分設定 (Aisles)</span>
                <span className="px-2 py-0.5 rounded bg-sky-950 border border-sky-800/60 text-sky-400 text-xs font-mono">
                  {aisles.length} 條走道
                </span>
              </h2>
              <p className="text-xs text-slate-400">在座位欄或列之間加入走道空間，模擬真實教室通道隔間</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Section 1: Vertical Aisles (Column separators) */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-sky-400 flex items-center space-x-2">
                <Columns className="w-4 h-4" />
                <span>縱向垂直走道（左、中、右分區）</span>
              </label>
              <span className="text-[11px] text-slate-400">點擊切換走道開關</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
              {Array.from({ length: Math.max(1, totalCols - 1) }).map((_, c) => {
                const isActive = aisles.some((a) => a.type === 'vertical' && a.index === c);
                return (
                  <button
                    key={`v-${c}`}
                    type="button"
                    onClick={() => handleToggleVertical(c)}
                    className={`p-2.5 rounded-lg border text-xs font-medium flex items-center justify-between transition-all ${
                      isActive
                        ? 'border-sky-500 bg-sky-950/70 text-sky-200 ring-1 ring-sky-500 shadow-md shadow-sky-950'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span>第 {c + 1} ~ {c + 2} 欄之間</span>
                    {isActive ? (
                      <span className="p-1 rounded bg-sky-600 text-white">
                        <Check className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="p-1 rounded bg-slate-800 text-slate-500">
                        <Plus className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Horizontal Aisles (Row separators) */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-amber-400 flex items-center space-x-2">
                <Rows className="w-4 h-4" />
                <span>橫向水平走道（前、中、後排分區）</span>
              </label>
              <span className="text-[11px] text-slate-400">點擊切換走道開關</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
              {Array.from({ length: Math.max(1, totalRows - 1) }).map((_, r) => {
                const rowLabelA = String.fromCharCode(65 + (r % 26));
                const rowLabelB = String.fromCharCode(65 + ((r + 1) % 26));
                const isActive = aisles.some((a) => a.type === 'horizontal' && a.index === r);
                return (
                  <button
                    key={`h-${r}`}
                    type="button"
                    onClick={() => handleToggleHorizontal(r)}
                    className={`p-2.5 rounded-lg border text-xs font-medium flex items-center justify-between transition-all ${
                      isActive
                        ? 'border-amber-500 bg-amber-950/70 text-amber-200 ring-1 ring-amber-500 shadow-md shadow-amber-950'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span>第 {rowLabelA} ~ {rowLabelB} 排之間</span>
                    {isActive ? (
                      <span className="p-1 rounded bg-amber-600 text-white">
                        <Check className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="p-1 rounded bg-slate-800 text-slate-500">
                        <Plus className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Aisles Summary */}
          <div className="text-xs text-slate-400 flex items-center justify-between bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
            <span>目前已配置 {aisles.filter((a) => a.type === 'vertical').length} 條垂直走道、{aisles.filter((a) => a.type === 'horizontal').length} 條橫向走道</span>
            {aisles.length > 0 && (
              <button
                type="button"
                onClick={() => setAisles([])}
                className="text-rose-400 hover:text-rose-300 transition-colors font-medium flex items-center space-x-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清除所有走道</span>
              </button>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 shadow-lg shadow-sky-600/30 transition-all flex items-center space-x-1.5"
          >
            <Save className="w-4 h-4" />
            <span>儲存走道配置</span>
          </button>
        </div>
      </div>
    </div>
  );
};
