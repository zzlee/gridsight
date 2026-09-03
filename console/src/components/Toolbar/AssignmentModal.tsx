import React, { useState } from 'react';
import {
  FolderDown,
  X,
  Play,
  Square,
  BellRing,
  Download,
  CheckCircle2,
  Clock,
  FileCode,
  AlertCircle,
  HardDrive
} from 'lucide-react';
import { AuthService } from '../../services/authService';
import type { ActiveAssignment, StudentDevice } from '../../types';

interface AssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTargets: string[];
  selectedCount: number;
  totalOnlineCount: number;
  activeAssignment: ActiveAssignment | null;
  allDevices: StudentDevice[];
  onRefresh: () => void;
}

export const AssignmentModal: React.FC<AssignmentModalProps> = ({
  isOpen,
  onClose,
  selectedTargets,
  selectedCount,
  totalOnlineCount,
  activeAssignment,
  allDevices,
  onRefresh,
}) => {
  const [title, setTitle] = useState('');
  const [allowedExts, setAllowedExts] = useState('cpp, py, zip');
  const [maxSizeMb, setMaxSizeMb] = useState(50);
  const [targetScope, setTargetScope] = useState<'all' | 'selected'>('all');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'submitted' | 'pending'>('all');

  if (!isOpen) return null;

  const handleStartCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalTitle = title.trim() || `課堂作業 (${new Date().toLocaleDateString()})`;
    const exts = allowedExts
      .split(',')
      .map((s) => s.trim().replace(/^\./, ''))
      .filter(Boolean);

    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const resp = await AuthService.fetchWithAuth('/api/assignments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: finalTitle,
          allowedExts: exts,
          maxSizeMb,
          targets: targetScope === 'selected' && selectedTargets.length > 0 ? selectedTargets : 'all',
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setStatusMessage(`🚀 已發起作業收取：「${finalTitle}」，正在通知學生端彈出繳交視窗！`);
        onRefresh();
      } else {
        setErrorMessage(data.error || '啟動失敗');
      }
    } catch {
      setErrorMessage('無法連線至伺服器');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStopCollection = async () => {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const resp = await AuthService.fetchWithAuth('/api/assignments/stop', {
        method: 'POST',
      });
      if (resp.ok) {
        setStatusMessage('⏹ 已結束作業收取，學生端繳交視窗已關閉');
        onRefresh();
      }
    } catch {
      setErrorMessage('停止收取失敗');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemindUnsubmitted = async () => {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const resp = await AuthService.fetchWithAuth('/api/assignments/remind', {
        method: 'POST',
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setStatusMessage(`📢 已向 ${data.remindedCount} 台尚未繳交的學生機再次發送提醒！`);
      } else {
        setErrorMessage(data.error || '催繳失敗');
      }
    } catch {
      setErrorMessage('催繳連線失敗');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!activeAssignment) return;
    setIsProcessing(true);
    try {
      const resp = await AuthService.fetchWithAuth(`/api/assignments/${activeAssignment.id}/download-zip`);
      if (!resp.ok) {
        setErrorMessage('ZIP 打包下載失敗');
        setIsProcessing(false);
        return;
      }
      const blob = await resp.blob();
      const safeTitle = activeAssignment.title.replace(/[/\\?%*:|"<>]/g, '_');
      const filename = `GridSight_作業_${safeTitle}.zip`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setStatusMessage(`💾 全班作業已成功下載：${filename} (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch {
      setErrorMessage('下載檔案失敗');
    } finally {
      setIsProcessing(false);
    }
  };

  const submissions = activeAssignment?.submissions || [];
  const submittedCount = submissions.length;
  const targetTotal = totalOnlineCount > 0 ? totalOnlineCount : submittedCount;
  const progressPercent = targetTotal > 0 ? Math.min(100, Math.round((submittedCount / targetTotal) * 100)) : 0;

  // Build the live submission board combining all target devices with submissions
  const boardData = allDevices.map((dev) => {
    const sub = submissions.find(
      (s) => s.mac.toLowerCase() === (dev.mac || '').toLowerCase()
    );
    return {
      mac: dev.mac || dev.id,
      seatNo: sub?.seatNo || dev.seatNo || '-',
      hostname: dev.hostname || '-',
      isSubmitted: !!sub,
      submission: sub,
    };
  });

  // Filter the board data
  const filteredBoard = boardData.filter((row) => {
    if (filterMode === 'all') return true;
    if (filterMode === 'submitted') return row.isSubmitted;
    if (filterMode === 'pending') return !row.isSubmitted;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex flex-col w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FolderDown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                課堂作業批次收取箱
                {activeAssignment?.active && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    收取中
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">
                {activeAssignment?.active
                  ? `「${activeAssignment.title}」收取進行中`
                  : '學生直接拖曳檔案至桌面小視窗即可繳交，支援自動覆蓋最新版與全班打包'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Status / Alert feedback */}
          {statusMessage && (
            <div className="flex items-start gap-2.5 p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{statusMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="flex items-start gap-2.5 p-3.5 bg-rose-950/40 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {activeAssignment?.active ? (
            /* --- Active Assignment State (Monitor & Management) --- */
            <div className="space-y-5">
              {/* Progress Summary Card */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-300 font-medium">繳交進度概況</span>
                  <span className="text-emerald-400 font-bold font-mono">
                    {submittedCount} / {targetTotal} 台 ({progressPercent}%)
                  </span>
                </div>
                {/* Progress Bar */}
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-1 border-t border-slate-800/80">
                  <div className="flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-sky-400" />
                    <span>限制格式: {activeAssignment.allowedExts.length > 0 ? activeAssignment.allowedExts.join(', ') : '格式不限'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                    <span>單檔上限: {activeAssignment.maxSizeMb} MB</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>發起時間: {new Date(activeAssignment.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={isProcessing || submittedCount === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow-lg shadow-emerald-950/40 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  下載全班作業打包 (ZIP)
                </button>
                <button
                  type="button"
                  onClick={handleRemindUnsubmitted}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-medium text-xs rounded-xl transition-colors"
                  title="向所有尚未繳交的學生電腦再次彈出提醒視窗"
                >
                  <BellRing className="w-4 h-4 text-amber-400" />
                  一鍵催繳
                </button>
                <button
                  type="button"
                  onClick={handleStopCollection}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-3.5 py-2.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-medium text-xs rounded-xl transition-colors"
                >
                  <Square className="w-4 h-4 text-rose-400" />
                  結束收取
                </button>
              </div>

              {/* Submissions List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-300">繳交名冊 ({boardData.length} 件)</span>
                  <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setFilterMode('all')}
                      className={`px-2 py-1 rounded text-xs transition-colors ${filterMode === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
                    >
                      全部
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('submitted')}
                      className={`px-2 py-1 rounded text-xs transition-colors ${filterMode === 'submitted' ? 'bg-emerald-600/40 text-emerald-300' : 'text-slate-400'}`}
                    >
                      已繳 ({submittedCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterMode('pending')}
                      className={`px-2 py-1 rounded text-xs transition-colors ${filterMode === 'pending' ? 'bg-amber-600/40 text-amber-300' : 'text-slate-400'}`}
                    >
                      未繳 ({boardData.length - submittedCount})
                    </button>
                  </div>
                </div>

                <div className="border border-slate-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                  {filteredBoard.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      沒有符合條件的學生
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 w-8">狀態</th>
                          <th className="px-3 py-2">座號</th>
                          <th className="px-3 py-2">電腦名稱</th>
                          <th className="px-3 py-2">檔案名稱</th>
                          <th className="px-3 py-2 text-right">大小</th>
                          <th className="px-3 py-2 text-right">時間</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {filteredBoard.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                            <td className="px-3 py-2">
                              {row.isSubmitted ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <Clock className="w-4 h-4 text-amber-400" />
                              )}
                            </td>
                            <td className={`px-3 py-2 font-bold ${row.isSubmitted ? 'text-emerald-400' : 'text-slate-400'}`}>{row.seatNo}</td>
                            <td className="px-3 py-2 text-slate-300 font-sans">{row.hostname}</td>
                            <td className="px-3 py-2 text-sky-300 truncate max-w-[160px]" title={row.submission?.filename || ''}>
                              {row.submission?.filename || '-'}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-400">
                              {row.submission ? `${(row.submission.size / 1024).toFixed(0)} KB` : '-'}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500 font-sans">
                              {row.submission ? new Date(row.submission.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* --- Start New Assignment Form --- */
            <form onSubmit={handleStartCollection} className="space-y-4">
              {/* Assignment Title */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  作業名稱
                </label>
                <input
                  type="text"
                  required
                  placeholder="例如：Lab-01 陣列與指標運算"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950/60 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
              </div>

              {/* Allowed Extensions & Max Size */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    限定格式副檔名 (逗號分隔)
                  </label>
                  <input
                    type="text"
                    placeholder="留空表示不限，例如 cpp, py, zip"
                    value={allowedExts}
                    onChange={(e) => setAllowedExts(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950/60 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    格式不符時學生端拖曳會即時警示並防呆攔截
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    單檔大小上限 (MB)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={maxSizeMb}
                    onChange={(e) => setMaxSizeMb(parseInt(e.target.value) || 50)}
                    className="w-full px-3.5 py-2.5 bg-slate-950/60 border border-slate-700/80 rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    預設 50 MB，學生重複繳交將自動覆蓋為最新版本
                  </span>
                </div>
              </div>

              {/* Target Scope Selection */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  收取對象範圍
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTargetScope('all')}
                    className={`flex items-center justify-between p-3 rounded-xl border text-xs text-left transition-all ${
                      targetScope === 'all'
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-slate-200">全班在線學生</div>
                      <div className="text-[11px] text-slate-500">向所有已連線之學生機發送</div>
                    </div>
                    <span className="font-mono text-emerald-400 font-bold">{totalOnlineCount} 台</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetScope('selected')}
                    disabled={selectedCount === 0}
                    className={`flex items-center justify-between p-3 rounded-xl border text-xs text-left transition-all ${
                      selectedCount === 0
                        ? 'opacity-40 cursor-not-allowed bg-slate-950/20 border-slate-800 text-slate-600'
                        : targetScope === 'selected'
                        ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-slate-200">目前框選之學生</div>
                      <div className="text-[11px] text-slate-500">
                        {selectedCount > 0 ? `已選取 ${selectedCount} 台` : '請先在畫布框選學生'}
                      </div>
                    </div>
                    <span className="font-mono text-emerald-400 font-bold">{selectedCount} 台</span>
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl shadow-lg shadow-emerald-950/50 transition-all duration-200"
                >
                  <Play className="w-4 h-4 fill-white" />
                  發起收取並於學生電腦彈出拖曳框
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
