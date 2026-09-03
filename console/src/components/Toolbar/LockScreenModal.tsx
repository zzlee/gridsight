import React, { useState, useEffect } from 'react';
import { Lock, Unlock, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { AuthService } from '../../services/authService';

interface LockScreenModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTargets?: string[];
  selectedCount?: number;
  totalOnlineCount?: number;
  initialMode?: 'LOCK' | 'UNLOCK';
}

const PRESET_MESSAGES = [
  '請看講台專心聽課',
  '隨堂測驗進行中，請勿操作',
  '小組討論時間，請注意聽講',
  '課堂專注模式，請暫停電腦操作',
];

export const LockScreenModal: React.FC<LockScreenModalProps> = ({
  isOpen,
  onClose,
  selectedTargets = [],
  selectedCount = 0,
  totalOnlineCount = 0,
  initialMode = 'LOCK',
}) => {
  const [message, setMessage] = useState<string>('請看講台專心聽課');
  const [targetScope, setTargetScope] = useState<'ALL' | 'SELECTED'>(
    selectedCount > 0 ? 'SELECTED' : 'ALL'
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setTargetScope(selectedCount > 0 ? 'SELECTED' : 'ALL');
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [isOpen, selectedCount]);

  if (!isOpen) return null;

  const handleExecute = async (action: 'LOCK' | 'UNLOCK') => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const isSelected = targetScope === 'SELECTED' && selectedTargets.length > 0;
      const targets = isSelected ? selectedTargets : 'all';
      const endpoint = action === 'LOCK' ? '/api/screen/lock' : '/api/screen/unlock';
      const body = action === 'LOCK' ? { targets, message: message.trim() } : { targets };

      const resp = await AuthService.fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || (action === 'LOCK' ? '執行鎖定失敗' : '執行解鎖失敗'));
      }

      const count = action === 'LOCK' ? (data.lockedCount ?? selectedCount) : (data.unlockedCount ?? selectedCount);
      setSuccessMsg(
        action === 'LOCK'
          ? `已成功鎖定 ${count} 台學生機的螢幕與鍵鼠！`
          : `已成功解除 ${count} 台學生機的螢幕鎖定！`
      );

      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100 flex flex-col space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">學生螢幕黑屏與鍵鼠鎖定</h2>
              <p className="text-xs text-slate-400">一鍵遮罩學生畫面並攔截鍵盤滑鼠操作，聚焦課堂注意力</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Target Scope Selection */}
        <div className="flex flex-col space-y-2">
          <label className="text-xs font-semibold text-slate-300">鎖定目標範圍</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setTargetScope('ALL')}
              className={`flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                targetScope === 'ALL'
                  ? 'bg-sky-600/20 border-sky-500 text-sky-200 shadow-sm'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <span>🏫 全班在線學生</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-900 font-mono">
                {totalOnlineCount} 台
              </span>
            </button>

            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => setTargetScope('SELECTED')}
              className={`flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${
                targetScope === 'SELECTED'
                  ? 'bg-sky-600/20 border-sky-500 text-sky-200 shadow-sm'
                  : selectedCount === 0
                  ? 'opacity-40 cursor-not-allowed border-slate-800 bg-slate-900/50 text-slate-600'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <span>🎯 目前框選學生</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-900 font-mono">
                {selectedCount} 台
              </span>
            </button>
          </div>
        </div>

        {/* Message Input & Quick Tags */}
        <div className="flex flex-col space-y-2">
          <label className="text-xs font-semibold text-slate-300">
            學生螢幕中央提示文字
          </label>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="請輸入提示文字（例如：請看講台專心聽課）"
            maxLength={60}
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition"
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PRESET_MESSAGES.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setMessage(preset)}
                className={`text-[10px] px-2 py-1 rounded-lg border transition ${
                  message === preset
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Error / Success Toast */}
        {errorMsg && (
          <div className="flex items-center space-x-2 text-xs text-rose-400 bg-rose-950/50 border border-rose-900/80 p-2.5 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="flex items-center space-x-2 text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-900/80 p-2.5 rounded-xl">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => handleExecute('UNLOCK')}
            className="flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl font-semibold text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 active:scale-[0.98] transition disabled:opacity-50"
          >
            <Unlock className="w-4 h-4 text-emerald-400" />
            <span>解除螢幕鎖定</span>
          </button>

          <button
            type="button"
            disabled={loading || !message.trim()}
            onClick={() => handleExecute('LOCK')}
            className="flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 shadow-lg shadow-amber-500/20 active:scale-[0.98] transition disabled:opacity-50"
          >
            <Lock className="w-4 h-4" />
            <span>{loading ? '執行中...' : '立即鎖定螢幕與鍵鼠'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
