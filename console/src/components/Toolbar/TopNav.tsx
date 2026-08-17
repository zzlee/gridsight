import React, { useRef } from 'react';
import { AppMode, ClassroomLayout } from '../../types';
import { LayoutStorage } from '../../services/layoutStorage';
import {
  Layers,
  Edit3,
  Eye,
  LayoutGrid,
  Download,
  Upload,
  HardDrive,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';

interface TopNavProps {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  layout: ClassroomLayout;
  onLayoutChange: (l: ClassroomLayout) => void;
  onOpenPresets: () => void;
  onOpenDevicePool: () => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  onResetView: () => void;
  onLock: () => void;
  onOpenChangePin: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  mode,
  setMode,
  layout,
  onLayoutChange,
  onOpenPresets,
  onOpenDevicePool,
  zoom,
  setZoom,
  onResetView,
  onLock,
  onOpenChangePin,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const jsonStr = LayoutStorage.exportLayoutJson(layout);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gridsight_layout_${layout.id}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const imported = LayoutStorage.importLayoutJson(content);
      if (imported) {
        onLayoutChange(imported);
        LayoutStorage.saveLayout(imported);
      }
    };
    reader.readAsText(file);
  };

  return (
    <header className="h-14 bg-slate-950 border-b border-slate-800 px-4 flex items-center justify-between z-30 select-none">
      {/* Brand Title & Classroom Title */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white shadow-md shadow-sky-600/30">
            GS
          </div>
          <div>
            <div className="font-bold text-slate-100 text-sm tracking-wide">GridSight</div>
            <div className="text-[10px] text-slate-400 font-medium">70人電腦教室螢幕即時監控系統</div>
          </div>
        </div>

        <div className="h-5 w-px bg-slate-800" />

        <div className="text-xs font-semibold text-slate-300 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
          {layout.name}
        </div>
      </div>

      {/* Central Mode Switcher & Tools */}
      <div className="flex items-center space-x-2">
        <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
          <button
            onClick={() => setMode('MONITOR')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              mode === 'MONITOR'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>監看模式</span>
          </button>
          <button
            onClick={() => setMode('EDIT_LAYOUT')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              mode === 'EDIT_LAYOUT'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>佈局編輯</span>
          </button>
        </div>

        <div className="h-5 w-px bg-slate-800" />

        {/* Layout Presets */}
        <button
          onClick={onOpenPresets}
          className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300"
          title="切換預設佈局"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>預設排位</span>
        </button>

        <button
          onClick={onOpenDevicePool}
          className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300"
          title="待分配設備池"
        >
          <HardDrive className="w-3.5 h-3.5" />
          <span>設備池</span>
        </button>

        {/* Zoom Controls */}
        <div className="flex items-center space-x-1 bg-slate-900 p-0.5 rounded border border-slate-800 text-slate-400">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
            className="p-1 hover:text-slate-200"
            title="縮小"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-mono w-10 text-center text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(2.0, z + 0.1))}
            className="p-1 hover:text-slate-200"
            title="放大"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onResetView}
            className="p-1 hover:text-slate-200"
            title="重置視角"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        {/* Import/Export JSON */}
        <button
          onClick={handleExport}
          className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
          title="匯出座位表 JSON"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
          title="匯入座位表 JSON"
        >
          <Upload className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
      </div>

      {/* Right: Security PIN settings & Lock Console */}
      <div className="flex items-center space-x-2.5">
        <button
          onClick={onOpenChangePin}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors text-xs font-semibold"
          title="修改教師安全 PIN 碼"
        >
          <span>🔑</span>
          <span>PIN 碼設定</span>
        </button>

        <button
          onClick={onLock}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-xs font-semibold transition-all shadow-sm"
          title="離開座位鎖定控制台"
        >
          <span>🔒</span>
          <span>鎖定控制台</span>
        </button>
      </div>
    </header>
  );
};
