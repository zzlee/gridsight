import React, { useState, useEffect } from 'react';
import { AuthService } from '../../services/authService';
import { Globe, X, Send, CheckCircle2, AlertCircle, Laptop, RotateCcw } from 'lucide-react';

interface ShareUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTargets?: string[];
  selectedCount?: number;
  totalOnlineCount?: number;
}

export const ShareUrlModal: React.FC<ShareUrlModalProps> = ({
  isOpen,
  onClose,
  selectedTargets = [],
  selectedCount = 0,
  totalOnlineCount = 0,
}) => {
  const [url, setUrl] = useState('');
  const [sendToAll, setSendToAll] = useState(selectedCount === 0);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [stats, setStats] = useState<{ total: number; success: number; failed: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setErrorMsg('');
      setSuccessMsg('');
      setProgress(0);
      setStats(null);
      setSendToAll(selectedCount === 0);
    }
  }, [isOpen, selectedCount]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setErrorMsg('請輸入要分享的網址');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setProgress(15);
    setStats(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const timer = setInterval(() => {
      setProgress((prev) => (prev < 90 ? prev + 15 : prev));
    }, 120);

    try {
      const targets = sendToAll || selectedCount === 0 ? [] : selectedTargets;
      const resp = await AuthService.fetchWithAuth('/api/share/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), targets }),
        signal: controller.signal,
      });

      clearInterval(timer);
      clearTimeout(timeoutId);

      const data = await resp.json();
      if (resp.ok && data.success) {
        setProgress(100);
        const total = data.totalTargets ?? (targets.length || totalOnlineCount);
        const succ = data.successCount ?? data.count ?? 0;
        const fail = data.failedCount ?? Math.max(0, total - succ);
        setStats({ total, success: succ, failed: fail });

        setSuccessMsg(data.message || `網址已成功發送！`);
        setTimeout(() => {
          onClose();
        }, fail > 0 ? 3000 : 1800);
      } else {
        setProgress(0);
        setErrorMsg(data.error || '網址發送失敗');
      }
    } catch (err: unknown) {
      clearInterval(timer);
      clearTimeout(timeoutId);
      setProgress(0);
      if (err instanceof Error && err.name === 'AbortError') {
        setErrorMsg('連線逾時 (超過 15 秒)，請檢查網路或學生端狀態');
        setStats({
          total: sendToAll || selectedCount === 0 ? totalOnlineCount : selectedTargets.length,
          success: 0,
          failed: sendToAll || selectedCount === 0 ? totalOnlineCount : selectedTargets.length,
        });
      } else {
        setErrorMsg('傳送失敗，請檢查網路連線或伺服器狀態');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">分享網址給學生</h3>
              <p className="text-xs text-slate-400">學生端接收後將自動開啟預設瀏覽器導向網址</p>
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
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Target Audience Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">發送對象</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSendToAll(true)}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  sendToAll
                    ? 'bg-sky-600/20 border-sky-500 text-sky-300 shadow-md shadow-sky-950/50'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <Laptop className="w-4 h-4 text-sky-400" />
                <span>全班學生 ({totalOnlineCount} 台)</span>
              </button>

              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={() => setSendToAll(false)}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  selectedCount === 0
                    ? 'opacity-40 cursor-not-allowed bg-slate-950/30 border-slate-800 text-slate-500'
                    : !sendToAll
                    ? 'bg-sky-600/20 border-sky-500 text-sky-300 shadow-md shadow-sky-950/50'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <Laptop className="w-4 h-4 text-emerald-400" />
                <span>已選取 ({selectedCount} 台)</span>
              </button>
            </div>
          </div>

          {/* URL Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">網址 (URL)</label>
            <div className="relative">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.google.com 或 https://..."
                autoFocus
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
              />
            </div>
            <p className="text-[11px] text-slate-500">若未輸入 http:// 或 https://，系統將自動補充 http://</p>
          </div>

          {/* Progress Bar */}
          {isLoading && (
            <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800 animate-in fade-in">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-sky-400">正在廣播網址至學生機...</span>
                <span className="text-slate-300 font-mono">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-sky-400 transition-all duration-150 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Stats Summary */}
          {stats && (
            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
              <div className="text-center">
                <p className="text-slate-400 text-[11px]">總目標數</p>
                <p className="font-bold text-slate-200 text-sm font-mono">{stats.total}</p>
              </div>
              <div className="text-center">
                <p className="text-emerald-400 text-[11px]">成功連線</p>
                <p className="font-bold text-emerald-400 text-sm font-mono">{stats.success}</p>
              </div>
              <div className="text-center">
                <p className="text-rose-400 text-[11px]">連線錯誤/逾時</p>
                <p className="font-bold text-rose-400 text-sm font-mono">{stats.failed}</p>
              </div>
            </div>
          )}

          {/* Error / Success Feedback */}
          {errorMsg && (
            <div className="flex items-center space-x-2 p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center space-x-2 p-3 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-xs animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2">
            {stats && stats.failed > 0 ? (
              <button
                type="submit"
                disabled={isLoading || !url.trim()}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重試失敗機台</span>
              </button>
            ) : <div />}

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isLoading || !url.trim()}
                className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs transition-all shadow-lg shadow-sky-600/30 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                <Send className="w-4 h-4" />
                <span>{isLoading ? '傳送中...' : '開啟學生端瀏覽器'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
