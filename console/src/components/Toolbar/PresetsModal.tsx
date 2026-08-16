import React from 'react';
import { ClassroomLayout } from '../../types';
import { LayoutStorage } from '../../services/layoutStorage';
import { LayoutGrid, Columns, SplitSquareVertical, X } from 'lucide-react';

interface PresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLayout: (layout: ClassroomLayout) => void;
}

export const PresetsModal: React.FC<PresetsModalProps> = ({
  isOpen,
  onClose,
  onSelectLayout,
}) => {
  if (!isOpen) return null;

  const presets = [
    {
      id: 'matrix',
      title: '標準矩陣 (7×10, 70台)',
      desc: '7 排 10 列緊湊排列，適合標準無走道式階梯/平面教室。',
      icon: LayoutGrid,
      action: () => onSelectLayout(LayoutStorage.getDefaultPreset('matrix')),
    },
    {
      id: 'aisle',
      title: '雙分區中走道 (左5×7 + 右5×7, 70台)',
      desc: '中央預留走道，左側 35 台、右側 35 台，最符合多數標準電腦教室配置。',
      icon: Columns,
      action: () => onSelectLayout(LayoutStorage.getDefaultPreset('aisle')),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <h3 className="font-bold text-slate-100 text-base">切換教室版型模板 (Presets)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {presets.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.id}
                onClick={() => {
                  p.action();
                  onClose();
                }}
                className="group flex items-start space-x-3 p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:border-sky-500/80 hover:bg-slate-900 cursor-pointer transition-all"
              >
                <div className="p-2 rounded-lg bg-slate-800 group-hover:bg-sky-500/20 text-sky-400">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200 group-hover:text-sky-300 text-sm">
                    {p.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {p.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
