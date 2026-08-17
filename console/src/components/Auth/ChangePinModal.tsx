import React, { useState } from 'react';
import { AuthService } from '../../services/authService';

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChangePinModal: React.FC<ChangePinModalProps> = ({ isOpen, onClose }) => {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPin || !newPin) {
      setError('請完整填寫所有欄位');
      return;
    }
    if (newPin !== confirmPin) {
      setError('新 PIN 碼與確認 PIN 碼不一致');
      return;
    }
    if (newPin.length < 4) {
      setError('新 PIN 碼長度至少需 4 位數');
      return;
    }

    setLoading(true);
    setError('');
    const res = await AuthService.changePin(currentPin, newPin);
    setLoading(false);

    if (res.success) {
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1500);
    } else {
      setError(res.error || '修改失敗');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
            <span>🔑</span>
            <span>修改教師安全 PIN 碼</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {success ? (
            <div className="p-4 bg-emerald-900/40 border border-emerald-700/60 rounded-xl text-emerald-400 text-center font-bold text-sm">
              ✅ PIN 碼已成功更新！
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-rose-900/40 border border-rose-700/60 rounded-xl text-rose-400 text-xs font-semibold">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">目前 PIN 碼</label>
                <input
                  type="password"
                  maxLength={12}
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value)}
                  placeholder="請輸入原 PIN 碼 (預設: 888888)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">新 PIN 碼 (至少 4 位數)</label>
                <input
                  type="password"
                  maxLength={12}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="請輸入新 PIN 碼"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">再次確認新 PIN 碼</label>
                <input
                  type="password"
                  maxLength={12}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  placeholder="請再次輸入新 PIN 碼"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-md shadow-sky-600/30"
                >
                  {loading ? '儲存中...' : '確認修改'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
