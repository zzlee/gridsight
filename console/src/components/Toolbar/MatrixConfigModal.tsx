import React, { useState } from 'react';
import { ClassroomLayout } from '../../types';
import { LayoutStorage } from '../../services/layoutStorage';
import { LayoutGrid, Check, X, Sparkles } from 'lucide-react';

interface MatrixConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLayout: ClassroomLayout;
  onApplyMatrix: (cols: number, rows: number, name: string, keepExisting: boolean) => void;
}

export const MatrixConfigModal: React.FC<MatrixConfigModalProps> = ({
  isOpen,
  onClose,
  currentLayout,
  onApplyMatrix,
}) => {
  const [cols, setCols] = useState<number>(() => currentLayout.cols || 8);
  const [rows, setRows] = useState<number>(() => Math.max(1, currentLayout.rows - 1) || 6);
  const [name, setName] = useState<string>(() => currentLayout.name || '電腦教室');
  const [keepExisting, setKeepExisting] = useState<boolean>(true);

  if (!isOpen) return null;

  const totalSeats = cols * rows;

  const quickPresets = [
    { label: '6 × 5 (30台)', c: 6, r: 5 },
    { label: '8 × 6 (48台)', c: 8, r: 6 },
    { label: '8 × 8 (64台)', c: 8, r: 8 },
    { label: '10 × 7 (70台)', c: 10, r: 7 },
    { label: '10 × 8 (80台)', c: 10, r: 8 },
    { label: '12 × 10 (120台)', c: 12, r: 10 },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cols >= 1 && rows >= 1) {
      onApplyMatrix(cols, rows, name, keepExisting);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 select-none">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-5">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-sky-500/20 text-sky-400">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-base">自訂 X × Y 標準矩陣佈局</h3>
              <p className="text-xs text-slate-400">無人數上限，自由設定教室行列規模</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Classroom Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              教室名稱 (Classroom Name)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-sky-500"
              placeholder="例如：電腦教室 101"
              required
            />
          </div>

          {/* Quick Preset Buttons */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">
              常用尺寸快速選取
            </label>
            <div className="grid grid-cols-3 gap-2">
              {quickPresets.map((p) => (
                <button
                  type="button"
                  key={p.label}
                  onClick={() => {
                    setCols(p.c);
                    setRows(p.r);
                  }}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-mono border transition-all ${
                    cols === p.c && rows === p.r
                      ? 'border-sky-500 bg-sky-500/20 text-sky-300 font-semibold'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Columns & Rows Input */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                橫向直欄數 (Cols / X)
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={cols}
                onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono text-center focus:outline-none focus:border-sky-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                縱向橫列數 (Rows / Y)
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={rows}
                onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono text-center focus:outline-none focus:border-sky-500"
                required
              />
            </div>
          </div>

          {/* Computed Seats summary badge */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between">
            <span className="text-xs text-slate-400">總座位席數規模：</span>
            <span className="text-base font-bold text-sky-400 font-mono">
              {totalSeats} <span className="text-xs text-slate-400 font-normal">台電腦</span>
            </span>
          </div>

          {/* Keep Existing Option */}
          <div className="flex items-center space-x-2 pt-1">
            <input
              type="checkbox"
              id="keepExisting"
              checked={keepExisting}
              onChange={(e) => setKeepExisting(e.target.checked)}
              className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-sky-600 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="keepExisting" className="text-xs text-slate-300 cursor-pointer">
              保留現有已排入之在線學生設備（超出邊界者自動移入設備池）
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-lg shadow-sky-600/30"
            >
              <Check className="w-4 h-4" />
              <span>套用並生成矩陣</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
