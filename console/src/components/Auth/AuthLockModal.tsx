import React, { useState, useEffect } from 'react';
import { AuthService } from '../../services/authService';

interface AuthLockModalProps {
  onUnlock: () => void;
}

export const AuthLockModal: React.FC<AuthLockModalProps> = ({ onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);

  const handleKeyPress = (num: string) => {
    if (pin.length < 12) {
      setPin((prev) => prev + num);
      setError('');
    }
  };

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pin) {
      setError('請輸入教師 PIN 碼');
      return;
    }

    setLoading(true);
    setError('');
    const res = await AuthService.login(pin, remember);
    setLoading(false);

    if (res.success) {
      onUnlock();
    } else {
      setError(res.error || 'PIN 碼錯誤');
      setPin('');
    }
  };

  // Listen for physical keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        setPin((prev) => (prev.length < 12 ? prev + e.key : prev));
        setError('');
      } else if (e.key === 'Backspace') {
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === 'Enter') {
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, remember]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-xl">
      <div className="w-full max-w-sm p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col items-center text-center">
        {/* Brand Icon */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4 animate-pulse">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-slate-100 tracking-tight">GridSight 教師控制台</h2>
        <p className="text-xs text-slate-400 mt-1 mb-5">請輸入教師安全 PIN 碼以解鎖管理權限</p>

        {/* PIN Dots Display */}
        <div className="w-full h-12 bg-slate-950/70 border border-slate-700/60 rounded-xl flex items-center justify-center px-4 mb-4">
          {pin.length === 0 ? (
            <span className="text-xs text-slate-500">請輸入 6 位數 PIN 碼 (預設: 888888)</span>
          ) : (
            <div className="flex items-center space-x-2">
              {pin.split('').map((_, i) => (
                <div key={i} className="w-3 h-3 rounded-full bg-sky-400 shadow-sm shadow-sky-400/50" />
              ))}
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="text-rose-400 text-xs font-semibold mb-3 animate-shake">
            {error}
          </div>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2.5 w-full mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              onClick={() => handleKeyPress(num)}
              className="h-12 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-sky-600 text-slate-100 text-lg font-bold transition-all border border-slate-700/50 shadow-sm flex items-center justify-center"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="h-12 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-slate-400 text-xs font-semibold transition-all border border-slate-800 flex items-center justify-center"
          >
            清除
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            className="h-12 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-sky-600 text-slate-100 text-lg font-bold transition-all border border-slate-700/50 shadow-sm flex items-center justify-center"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="h-12 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-slate-400 text-xs font-semibold transition-all border border-slate-800 flex items-center justify-center"
          >
            ⌫
          </button>
        </div>

        {/* Remember Checkbox & Submit */}
        <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-4 px-1">
          <label className="flex items-center space-x-2 cursor-pointer hover:text-slate-200">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0"
            />
            <span>記住此瀏覽器</span>
          </label>
          <span className="text-[11px] text-slate-500">預設: 888888</span>
        </div>

        <button
          onClick={() => handleSubmit()}
          disabled={loading || pin.length === 0}
          className={`w-full py-3 rounded-xl font-bold text-sm tracking-wide transition-all shadow-lg ${
            pin.length > 0
              ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-600/30 active:scale-[0.98]'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {loading ? '驗證中...' : '解鎖控制台'}
        </button>
      </div>
    </div>
  );
};
