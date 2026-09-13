import React, { useState } from 'react';
import {
  ClipboardCheck,
  X,
  Play,
  Square,
  BellRing,
  Download,
  CheckCircle2,
  Clock,
  RotateCcw,
  AlertCircle,
  Users
} from 'lucide-react';
import { AuthService } from '../../services/authService';
import type { ActiveRollCall, StudentDevice } from '../../types';

interface RollCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTargets: string[];
  selectedCount: number;
  totalOnlineCount: number;
  activeRollCall: ActiveRollCall | null;
  allDevices: StudentDevice[];
  onRefresh: () => void;
}

export const RollCallModal: React.FC<RollCallModalProps> = ({
  isOpen,
  onClose,
  selectedTargets,
  selectedCount,
  totalOnlineCount,
  activeRollCall,
  allDevices,
  onRefresh,
}) => {
  const [title, setTitle] = useState('');
  const [targetScope, setTargetScope] = useState<'all' | 'selected'>('all');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'checkedIn' | 'pending'>('all');

  if (!isOpen) return null;

  const handleStartRollCall = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalTitle = title.trim() || `課堂點名 (${new Date().toLocaleDateString()})`;

    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const resp = await AuthService.fetchWithAuth('/api/rollcall/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: finalTitle,
          targets: targetScope === 'selected' && selectedTargets.length > 0 ? selectedTargets : 'all',
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setStatusMessage(`🚀 已向學生機發起課堂點名：「${finalTitle}」，學生端已跳出學號輸入視窗！`);
        onRefresh();
      } else {
        setErrorMessage(data.error || '發起點名失敗');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '連線伺服器失敗');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStopRollCall = async () => {
    if (!confirm('確定要結束本次課堂點名嗎？未簽到的學生視窗將自動關閉。')) return;

    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const resp = await AuthService.fetchWithAuth('/api/rollcall/stop', {
        method: 'POST',
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setStatusMessage('⏹ 課堂點名已結束。您隨時可在此匯出本次點名名冊。');
        onRefresh();
      } else {
        setErrorMessage(data.error || '結束點名失敗');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '連線失敗');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemindPending = async () => {
    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const pendingMacs = allDevices
      .filter((d) => d.status !== 'offline' && !d.studentId)
      .map((d) => d.mac || d.id);

    if (pendingMacs.length === 0) {
      setStatusMessage('🎉 所有在線學生皆已完成簽到，無需催點！');
      setIsProcessing(false);
      return;
    }

    try {
      const resp = await AuthService.fetchWithAuth('/api/rollcall/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: pendingMacs,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setStatusMessage(`🔔 已對 ${data.targetCount} 台尚未簽到的學生機再次彈出簽到視窗！`);
        onRefresh();
      } else {
        setErrorMessage(data.error || '催點失敗');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '催點失敗');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRePromptStudent = async (mac: string, hostname: string) => {
    try {
      const resp = await AuthService.fetchWithAuth('/api/rollcall/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: [mac],
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        setStatusMessage(`🔄 已向 ${hostname} 重新發起簽到視窗，等待學生重新輸入學號。`);
        onRefresh();
      }
    } catch {
      setErrorMessage('重新發起點名失敗');
    }
  };

  const handleExportCsv = async () => {
    try {
      const resp = await AuthService.fetchWithAuth('/api/rollcall/export-csv');
      if (!resp.ok) {
        throw new Error('匯出名冊失敗');
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const titleClean = (activeRollCall?.title || '課堂點名').replace(/[/\\?%*:|"<>]/g, '_');
      a.download = `GridSight_點名名冊_${titleClean}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '下載 CSV 失敗');
    }
  };

  // Metrics computation
  const checkedInCount = allDevices.filter((d) => !!d.studentId).length;
  const totalCount = allDevices.length;
  const progressPct = totalCount > 0 ? Math.round((checkedInCount / totalCount) * 100) : 0;

  const displayList = allDevices.filter((d) => {
    if (filterMode === 'checkedIn') return !!d.studentId;
    if (filterMode === 'pending') return !d.studentId;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
              <ClipboardCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white tracking-wide">課堂點名系統</h2>
                {activeRollCall?.active ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span> 點名進行中
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
                    未在點名
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeRollCall?.active
                  ? `「${activeRollCall.title}」正在進行，學生端輸入學號後即時同步更新`
                  : '透過出站反向連線向學生機下發點名指令，學生機跳出視窗輸入學號'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Banners */}
        {statusMessage && (
          <div className="px-6 py-2 bg-emerald-950/70 border-b border-emerald-800/80 text-emerald-300 text-xs flex items-center justify-between">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage(null)} className="text-emerald-400 hover:text-emerald-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {errorMessage && (
          <div className="px-6 py-2 bg-rose-950/70 border-b border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
            <span className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Active Roll Call Summary Bar */}
          {activeRollCall?.active ? (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">點名活動：「{activeRollCall.title}」</h3>
                  <div className="flex items-center space-x-4 text-xs text-slate-400 mt-1">
                    <span>發起時間: {new Date(activeRollCall.createdAt).toLocaleTimeString()}</span>
                    <span>出席率: <strong className="text-emerald-400 font-mono">{progressPct}%</strong></span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleRemindPending}
                    disabled={isProcessing}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition-all disabled:opacity-50 shadow-sm"
                    title="對尚未簽到的學生機再次彈出輸入視窗"
                  >
                    <BellRing className="w-3.5 h-3.5" />
                    <span>🔔 催點未簽到</span>
                  </button>

                  <button
                    onClick={handleExportCsv}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 text-xs font-semibold transition-all shadow-sm"
                    title="匯出目前點名結果為 CSV 檔"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>📥 匯出名冊 (CSV)</span>
                  </button>

                  <button
                    onClick={handleStopRollCall}
                    disabled={isProcessing}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 hover:border-transparent text-xs font-semibold transition-all disabled:opacity-50"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>⏹ 結束點名</span>
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono text-slate-400">
                  <span>簽到進度: <strong className="text-white">{checkedInCount}</strong> / {totalCount} 台</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Start Roll Call Form */
            <form onSubmit={handleStartRollCall} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">點名活動名稱</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={`課堂點名 (${new Date().toLocaleDateString()})`}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">點名發起對象</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTargetScope('all')}
                      className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                        targetScope === 'all'
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-sm shadow-emerald-950'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>全班學生 ({totalOnlineCount} 在線)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetScope('selected')}
                      disabled={selectedCount === 0}
                      className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                        targetScope === 'selected'
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-sm shadow-emerald-950'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                      } ${selectedCount === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <span>目前所選 ({selectedCount} 台)</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>匯出歷次名冊 (CSV)</span>
                </button>

                <button
                  type="submit"
                  disabled={isProcessing}
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-950/60 transition-all disabled:opacity-50 active:scale-95"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>🚀 開始課堂點名</span>
                </button>
              </div>
            </form>
          )}

          {/* Student List Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs">
                <span className="font-semibold text-slate-300">學生簽到明細 ({allDevices.length})</span>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    filterMode === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  全部 ({allDevices.length})
                </button>
                <button
                  onClick={() => setFilterMode('checkedIn')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    filterMode === 'checkedIn' ? 'bg-emerald-900/60 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  已簽到 ({checkedInCount})
                </button>
                <button
                  onClick={() => setFilterMode('pending')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    filterMode === 'pending' ? 'bg-rose-900/60 text-rose-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  未簽到 ({totalCount - checkedInCount})
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/50">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="py-2.5 px-3 w-16">座號</th>
                    <th className="py-2.5 px-3">學號 (Student ID)</th>
                    <th className="py-2.5 px-3">電腦主機名稱</th>
                    <th className="py-2.5 px-3">IP 位址</th>
                    <th className="py-2.5 px-3">簽到狀態</th>
                    <th className="py-2.5 px-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {displayList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        無符合篩選條件的學生記錄
                      </td>
                    </tr>
                  ) : (
                    displayList.map((dev) => {
                      const isCheckedIn = !!dev.studentId;
                      return (
                        <tr key={dev.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-bold text-sky-400">
                            {dev.seatNo || '未排座'}
                          </td>
                          <td className="py-2.5 px-3">
                            {isCheckedIn ? (
                              <span className="inline-flex items-center gap-1 font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                                🎓 {dev.studentId}
                              </span>
                            ) : (
                              <span className="font-mono text-slate-500 italic">未簽到</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-300">
                            {dev.hostname || dev.mac}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">
                            {dev.ip}
                          </td>
                          <td className="py-2.5 px-3">
                            {isCheckedIn ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" /> 已簽到
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-slate-500 font-medium">
                                <Clock className="w-3.5 h-3.5" /> 等待中
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => handleRePromptStudent(dev.mac || dev.id, dev.hostname)}
                              disabled={dev.status === 'offline'}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-emerald-700 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-medium transition-colors disabled:opacity-40"
                              title="若學生輸入錯誤，點擊可單獨向此學生機重新彈出學號輸入框"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>要求重填</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/80 text-xs text-slate-400">
          <span>提示：若學生輸入錯誤學號，可在清單右側點擊「要求重填」，該學生機將再次跳出輸入視窗。</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
          >
            關閉視窗
          </button>
        </div>
      </div>
    </div>
  );
};
