import React, { useState } from 'react';
import { AlertTriangle, Power, X, Clock, CheckCircle2 } from 'lucide-react';
import { AuthService } from '../../services/authService';

interface ShutdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTargets?: string[];
  selectedCount?: number;
  totalOnlineCount?: number;
}

export const ShutdownModal: React.FC<ShutdownModalProps> = ({
  isOpen,
  onClose,
  selectedTargets = [],
  selectedCount = 0,
  totalOnlineCount = 0,
}) => {
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(30);
  const [targetScope, setTargetScope] = useState<'ALL' | 'SELECTED'>(
    selectedCount > 0 ? 'SELECTED' : 'ALL'
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  if (!isOpen) return null;

  const handleConfirmShutdown = async () => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const targets = targetScope === 'SELECTED' && selectedTargets.length > 0 ? selectedTargets : ['ALL'];
      const resp = await AuthService.fetchWithAuth('/api/power/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets,
          timeout: timeoutSeconds,
        }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || '傳送關機指令失敗');
      }

      setSuccessMsg(data.message || `已成功廣播關機指令至 ${data.count} 台學生機！`);
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelActiveShutdown = async () => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const targets = targetScope === 'SELECTED' && selectedTargets.length > 0 ? selectedTargets : ['ALL'];
      const resp = await AuthService.fetchWithAuth('/api/power/cancel-shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || '傳送取消關機指令失敗');
      }

      setSuccessMsg(data.message || `已成功廣播取消關機指令至 ${data.count} 台學生機！`);
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-rose-500/40 rounded-2xl shadow-2xl shadow-rose-950/50 overflow-hidden text-slate-100 select-none">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-rose-950/40 border-b border-rose-500/30">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-rose-600/20 border border-rose-500/40 text-rose-400">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-base text-rose-200">廣播關閉學生端電腦警告</h3>
              <p className="text-xs text-rose-300/70">遠端關機控制系統</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Warning Banner */}
          <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/60 text-xs text-rose-200 leading-relaxed space-y-1.5">
            <p className="font-semibold text-rose-300 flex items-center space-x-1.5">
              <span>⚠️ 注意：您即將對學生端電腦發送廣播關機指令</span>
            </p>
            <p className="text-slate-300">
              學生機收到指令後，將會跳出 <b className="text-rose-300">倒數計時畫面</b>。倒數時間結束且未點擊取消，電腦將會直接關機。
            </p>
          </div>

          {/* Scope Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">關機目標範圍</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTargetScope('ALL')}
                className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                  targetScope === 'ALL'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                全班在線主機 ({totalOnlineCount} 台)
              </button>
              <button
                type="button"
                onClick={() => setTargetScope('SELECTED')}
                disabled={selectedCount === 0}
                className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  targetScope === 'SELECTED'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                已選取主機 ({selectedCount} 台)
              </button>
            </div>
          </div>

          {/* Countdown Timeout Setting */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>學生端倒數計時關機時間</span>
              </label>
              <span className="text-xs font-mono font-bold text-amber-400">{timeoutSeconds} 秒</span>
            </div>
            <div className="flex items-center space-x-2">
              {[15, 30, 60, 120].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setTimeoutSeconds(sec)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
                    timeoutSeconds === sec
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* Alert Messages */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-500 text-xs text-emerald-200 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950/60 border-t border-slate-800">
          <button
            type="button"
            onClick={handleCancelActiveShutdown}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition-colors disabled:opacity-50"
            title="發送指令終止已啟動之倒數關機視窗"
          >
            🛑 撤銷/取消進行中關機
          </button>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            >
              關閉
            </button>
            <button
              type="button"
              onClick={handleConfirmShutdown}
              disabled={loading || !!successMsg}
              className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-lg shadow-rose-950 active:scale-95 disabled:opacity-50"
            >
              <Power className="w-4 h-4" />
              <span>{loading ? '正在發送指令...' : '確認廣播關機'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
