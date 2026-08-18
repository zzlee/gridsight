import React, { useState } from 'react';
import { StudentDevice } from '../../types';
import { X, Save, Edit3, Hash, Users, Unlink } from 'lucide-react';

interface BatchEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedSeats: StudentDevice[];
  onApplyBatchEdit: (options: {
    prefixMode?: 'ROW_COL' | 'NUMBER' | 'CUSTOM';
    customPrefix?: string;
    startNumber?: number;
    clearUsernames?: boolean;
    setCommonGroup?: string;
    unbindDevices?: boolean;
  }) => void;
}

export const BatchEditModal: React.FC<BatchEditModalProps> = ({
  isOpen,
  onClose,
  selectedSeats,
  onApplyBatchEdit,
}) => {
  const [prefixMode, setPrefixMode] = useState<'ROW_COL' | 'NUMBER' | 'CUSTOM'>('ROW_COL');
  const [customPrefix, setCustomPrefix] = useState('PC-');
  const [startNumber, setStartNumber] = useState(1);
  const [clearUsernames, setClearUsernames] = useState(false);
  const [setCommonGroup, setSetCommonGroup] = useState('');
  const [unbindDevices, setUnbindDevices] = useState(false);

  if (!isOpen || selectedSeats.length === 0) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onApplyBatchEdit({
      prefixMode,
      customPrefix,
      startNumber,
      clearUsernames,
      setCommonGroup: setCommonGroup.trim() || undefined,
      unbindDevices,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>批次編輯座位</span>
                <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800/60 text-emerald-400 text-xs font-mono">
                  共 {selectedSeats.length} 個座位
                </span>
              </h2>
              <p className="text-xs text-slate-400">對所有選取的座位同時套用編號與屬性設定</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Section 1: Seat Numbering Scheme */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
            <label className="block text-xs font-semibold text-sky-400 flex items-center space-x-1.5">
              <Hash className="w-4 h-4" />
              <span>座號批次重編規則</span>
            </label>

            <div className="space-y-2 text-xs">
              <label className="flex items-center space-x-2.5 text-slate-200 cursor-pointer">
                <input
                  type="radio"
                  name="numberingScheme"
                  checked={prefixMode === 'ROW_COL'}
                  onChange={() => setPrefixMode('ROW_COL')}
                  className="text-sky-500 focus:ring-sky-500"
                />
                <span>依網格行列座標自動編號（如 A1, A2, B1, B2...）</span>
              </label>

              <label className="flex items-center space-x-2.5 text-slate-200 cursor-pointer">
                <input
                  type="radio"
                  name="numberingScheme"
                  checked={prefixMode === 'NUMBER'}
                  onChange={() => setPrefixMode('NUMBER')}
                  className="text-sky-500 focus:ring-sky-500"
                />
                <span>純數字流水號（如 01, 02, 03...）</span>
              </label>

              <label className="flex items-center space-x-2.5 text-slate-200 cursor-pointer">
                <input
                  type="radio"
                  name="numberingScheme"
                  checked={prefixMode === 'CUSTOM'}
                  onChange={() => setPrefixMode('CUSTOM')}
                  className="text-sky-500 focus:ring-sky-500"
                />
                <span>自訂前綴流水號</span>
              </label>

              {prefixMode === 'CUSTOM' && (
                <div className="pt-2 pl-6 flex items-center space-x-2">
                  <span className="text-slate-400">前綴:</span>
                  <input
                    type="text"
                    value={customPrefix}
                    onChange={(e) => setCustomPrefix(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono w-28 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    placeholder="如 PC-"
                  />
                  <span className="text-slate-400">起始號:</span>
                  <input
                    type="number"
                    min="1"
                    value={startNumber}
                    onChange={(e) => setStartNumber(parseInt(e.target.value, 10) || 1)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono w-20 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Student Attributes */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
            <label className="block text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
              <Users className="w-4 h-4 text-emerald-400" />
              <span>學生資訊與備註管理</span>
            </label>

            <div className="space-y-2 text-xs">
              <label className="flex items-center space-x-2.5 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearUsernames}
                  onChange={(e) => setClearUsernames(e.target.checked)}
                  className="rounded text-sky-500 focus:ring-sky-500"
                />
                <span>清空已選座位的學生姓名與自訂備註</span>
              </label>

              <div>
                <label className="block text-slate-400 mb-1">批次設定統一分組 / 備註標籤：</label>
                <input
                  type="text"
                  value={setCommonGroup}
                  onChange={(e) => setSetCommonGroup(e.target.value)}
                  placeholder="留空表示不變更"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Device Binding Options */}
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
            <label className="flex items-center space-x-2.5 text-xs text-rose-300 cursor-pointer">
              <input
                type="checkbox"
                checked={unbindDevices}
                onChange={(e) => setUnbindDevices(e.target.checked)}
                className="rounded text-rose-500 focus:ring-rose-500"
              />
              <span className="flex items-center space-x-1 font-semibold">
                <Unlink className="w-3.5 h-3.5" />
                <span>解除實體設備綁定（將設備退回設備池，保留空白座位）</span>
              </span>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 shadow-lg shadow-sky-600/30 transition-all flex items-center space-x-1.5"
            >
              <Save className="w-4 h-4" />
              <span>套用批次設定</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
