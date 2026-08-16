import React, { useRef } from 'react';
import { AppMode, BroadcastConfig, ClassroomLayout } from '../../types';
import { BroadcastControl } from '../Broadcast/BroadcastControl';
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
  broadcastConfig: BroadcastConfig;
  onToggleBroadcast: () => void;
  onOpenPresets: () => void;
  onOpenDevicePool: () => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  onResetView: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  mode,
  setMode,
  layout,
  onLayoutChange,
  broadcastConfig,
  onToggleBroadcast,
  onOpenPresets,
  onOpenDevicePool,
  zoom,
  setZoom,
  onResetView,
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
            <div className="text-[10px] text-slate-400 font-medium">70人電腦教室螢幕監控與實時廣播</div>
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
                ? 'bg-amber-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>排版模式</span>
          </button>
        </div>

        {/* Layout tools (available in edit mode or always) */}
        <button
          onClick={onOpenPresets}
          className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300"
          title="切換版型模板"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>模板</span>
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

      {/* Right: UDP Multicast Broadcast Controller */}
      <BroadcastControl
        config={broadcastConfig}
        onToggleBroadcast={onToggleBroadcast}
      />
    </header>
  );
};
