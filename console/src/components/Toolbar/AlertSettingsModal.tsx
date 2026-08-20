import React, { useState } from 'react';
import { StudentDevice } from '../../types';
import {
  AlertTriangle,
  X,
  Plus,
  RotateCcw,
  Check,
  Eye,
  ShieldAlert,
  Search,
  Sparkles,
} from 'lucide-react';

interface AlertSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  keywords: string[];
  onUpdateKeywords: (keywords: string[]) => void;
  alertsEnabled: boolean;
  onToggleAlertsEnabled: (enabled: boolean) => void;
  offTaskDevices: StudentDevice[];
  onFocusDevice: (device: StudentDevice) => void;
  filterOnlyOffTask: boolean;
  onToggleFilterOnlyOffTask: (filter: boolean) => void;
}

export const DEFAULT_OFFTASK_KEYWORDS = [
  'YouTube',
  'Bilibili',
  'Roblox',
  'Minecraft',
  'Steam',
  'Discord',
  'Twitch',
  '抖音',
  'Tiktok',
  '巴哈姆特',
  '動畫瘋',
  'Facebook',
  'Instagram',
  'Netflix',
  'Game',
  '遊戲',
];

export const AlertSettingsModal: React.FC<AlertSettingsModalProps> = ({
  isOpen,
  onClose,
  keywords,
  onUpdateKeywords,
  alertsEnabled,
  onToggleAlertsEnabled,
  offTaskDevices,
  onFocusDevice,
  filterOnlyOffTask,
  onToggleFilterOnlyOffTask,
}) => {
  const [newKeyword, setNewKeyword] = useState('');
  const [activeTab, setActiveTab] = useState<'flagged' | 'keywords'>('flagged');

  if (!isOpen) return null;

  const handleAddKeyword = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    if (!keywords.some((k) => k.toLowerCase() === trimmed.toLowerCase())) {
      onUpdateKeywords([...keywords, trimmed]);
    }
    setNewKeyword('');
  };

  const handleRemoveKeyword = (keywordToRemove: string) => {
    onUpdateKeywords(keywords.filter((k) => k !== keywordToRemove));
  };

  const handleResetDefaults = () => {
    onUpdateKeywords(DEFAULT_OFFTASK_KEYWORDS);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
                課堂離題關鍵字警示 (Off-Task Alert)
                {offTaskDevices.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 font-mono font-bold animate-pulse">
                    {offTaskDevices.length} 台疑似離題
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">
                自動監控學生目前操作之視窗標題，發現遊戲/影音時高亮警示
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Controls & Tabs */}
        <div className="px-6 py-3 bg-slate-950/30 border-b border-slate-800 flex items-center justify-between">
          {/* Master Enable Toggle */}
          <label className="flex items-center space-x-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={alertsEnabled}
              onChange={(e) => onToggleAlertsEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600"></div>
            <span className="text-xs font-semibold text-slate-300">
              {alertsEnabled ? '警示高亮已啟用' : '警示功能已關閉'}
            </span>
          </label>

          {/* Sub Tabs */}
          <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('flagged')}
              className={`px-3 py-1 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'flagged'
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>違規名單 ({offTaskDevices.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('keywords')}
              className={`px-3 py-1 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'keywords'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>關鍵字庫 ({keywords.length})</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'flagged' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">
                  目前操作視窗含有離題關鍵字的學生：
                </span>
                <button
                  onClick={() => onToggleFilterOnlyOffTask(!filterOnlyOffTask)}
                  className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors flex items-center gap-1.5 ${
                    filterOnlyOffTask
                      ? 'bg-rose-600/30 border-rose-500 text-rose-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{filterOnlyOffTask ? '畫布已鎖定離題學生' : '在畫布僅篩選離題學生'}</span>
                </button>
              </div>

              {offTaskDevices.length === 0 ? (
                <div className="py-10 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl space-y-2">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
                    <Check className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">全班專心度良好！</p>
                  <p className="text-xs text-slate-500">目前沒有偵測到任何離題關鍵字程式。</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {offTaskDevices.map((dev) => (
                    <div
                      key={dev.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-rose-500/40 hover:border-rose-500 transition-all shadow-sm"
                    >
                      <div className="flex items-center space-x-3 overflow-hidden">
                        <span className="px-2 py-1 rounded bg-rose-500/20 text-rose-400 font-mono font-bold text-xs shrink-0">
                          {dev.seatNo || '未分配'}
                        </span>
                        <div className="truncate">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200 text-sm">{dev.hostname}</span>
                            <span className="text-xs text-slate-500 font-mono">({dev.ip})</span>
                          </div>
                          <div className="text-xs text-rose-300 font-medium truncate" title={dev.activeWindow}>
                            ⚠️ 使用中：{dev.activeWindow || '未知程式'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          onFocusDevice(dev);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 shadow transition-colors"
                        title="開啟 30 FPS 焦點監看"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>即時監看</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Add Keyword Input */}
              <form onSubmit={handleAddKeyword} className="flex gap-2">
                <input
                  type="text"
                  placeholder="輸入要警示的關鍵字（如：Game, 抖音, YouTube, 楓之谷）"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  className="flex-1 px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  disabled={!newKeyword.trim()}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>新增</span>
                </button>
              </form>

              {/* Keywords Tag Cloud */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>目前比對關鍵字庫（不分大小寫模糊匹配）：</span>
                  <button
                    onClick={handleResetDefaults}
                    className="text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>恢復預設庫</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 p-3 bg-slate-950/60 border border-slate-800 rounded-xl min-h-[120px] max-h-60 overflow-y-auto">
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/60 border border-rose-500/30 text-rose-300 text-xs font-medium group hover:border-rose-500 transition-colors"
                    >
                      <span>{kw}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveKeyword(kw)}
                        className="text-rose-400/60 hover:text-rose-200"
                        title={`刪除關鍵字「${kw}」`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  {keywords.length === 0 && (
                    <span className="text-xs text-slate-500 italic p-2">
                      尚未設定任何關鍵字，請在上方輸入新增。
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>提示：學生端每秒隨心跳回傳當前焦點視窗，系統將自動比對。</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
