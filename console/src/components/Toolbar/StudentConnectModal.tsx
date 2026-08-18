import React, { useState } from 'react';
import { X, Copy, Check, Download, Terminal, PowerOff, Sparkles, ExternalLink, QrCode, Monitor } from 'lucide-react';

interface StudentConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  isStandalonePage?: boolean;
}

export const StudentConnectModal: React.FC<StudentConnectModalProps> = ({
  isOpen,
  onClose,
  isStandalonePage = false,
}) => {
  const [copiedType, setCopiedType] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentHost = window.location.host || '192.168.1.200:3000';
  const joinUrl = `${window.location.protocol}//${currentHost}/join`;

  // Win + R one-liner (executes powershell silently in background)
  const winRCommand = `powershell -WindowStyle Hidden -c "irm http://${currentHost}/install-agent.ps1|iex"`;
  
  // Standard PowerShell one-liner
  const psCommand = `irm http://${currentHost}/install-agent.ps1 | iex`;

  // Stop command
  const stopCommand = `powershell -WindowStyle Hidden -c "irm http://${currentHost}/stop-agent.ps1|iex"`;

  const copyToClipboard = async (text: string): Promise<boolean> => {
    // 1. Try modern Async Clipboard API if supported (HTTPS or localhost)
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall back to execCommand
      }
    }

    // 2. Universal fallback for non-secure HTTP origins (e.g. http://192.168.x.x:3000)
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.warn('[Copy] Failed to copy to clipboard:', err);
      return false;
    }
  };

  const handleCopy = async (text: string, type: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 3000);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${isStandalonePage ? 'bg-slate-950' : 'bg-slate-950/85 backdrop-blur-md'}`}>
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
              <Monitor className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-lg flex items-center gap-2">
                學生端 1 秒極速加入教室
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  極簡 0 設定
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                學生打開瀏覽器或按下快捷鍵即可秒速連線，無需手動輸入長指令
              </p>
            </div>
          </div>
          {!isStandalonePage && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Method 1: The Ultimate 1-Click Win+R Method */}
          <div className="p-5 rounded-xl bg-gradient-to-br from-sky-950/50 via-slate-900 to-slate-950 border-2 border-sky-500/40 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 px-3 py-1 bg-sky-500 text-slate-950 text-xs font-black uppercase tracking-wider rounded-bl-lg flex items-center gap-1 shadow">
              <Sparkles className="w-3.5 h-3.5" /> 推薦方式
            </div>

            <h4 className="text-sm font-bold text-sky-300 mb-3 flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-500 text-slate-950 font-black text-xs">
                1
              </span>
              Windows 快速執行（Win + R 貼上即連線）
            </h4>

            {/* 3 Step Visual Guide */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center">
                <span className="text-xs font-semibold text-slate-400 block mb-1">步驟 1</span>
                <span className="text-xs font-bold text-sky-300">點擊下方按鈕複製</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center">
                <span className="text-xs font-semibold text-slate-400 block mb-1">步驟 2</span>
                <span className="text-xs font-bold text-amber-300">鍵盤按 Win + R</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center">
                <span className="text-xs font-semibold text-slate-400 block mb-1">步驟 3</span>
                <span className="text-xs font-bold text-emerald-300">Ctrl + V 貼上按 Enter</span>
              </div>
            </div>

            {/* Big Action Copy Button */}
            <button
              onClick={() => handleCopy(winRCommand, 'winR')}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold text-sm shadow-lg shadow-sky-600/30 flex items-center justify-center space-x-2 transition-all active:scale-[0.98]"
            >
              {copiedType === 'winR' ? (
                <>
                  <Check className="w-5 h-5 text-emerald-300" />
                  <span>✅ 已複製指令！請現在按下 Win + R 貼上並按 Enter</span>
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5" />
                  <span>📋 點此一鍵複製 Win + R 執行指令</span>
                </>
              )}
            </button>

            {/* Code preview snippet */}
            <div
              onClick={() => handleCopy(winRCommand, 'winR_raw')}
              className="mt-3 bg-slate-950 px-3 py-2 rounded-lg border border-slate-800/80 hover:border-sky-500/50 flex items-center justify-between text-xs font-mono text-slate-300 cursor-pointer transition-colors overflow-x-auto"
              title="點擊直接複製"
            >
              <span className="truncate mr-2 select-all">{winRCommand}</span>
              <span className="text-sky-400 hover:text-sky-300 shrink-0 font-sans text-xs font-bold">
                {copiedType === 'winR_raw' ? '✅ 已複製' : '📋 複製'}
              </span>
            </div>
          </div>

          {/* Method 2: Open Student Web Portal (For projection onto screen) */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-emerald-400" />
              教師廣播/投影用加入網址 (學生可直接打開此頁複製)
            </h4>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={joinUrl}
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-emerald-400 font-mono focus:outline-none select-all"
              />
              <button
                onClick={() => handleCopy(joinUrl, 'joinUrl')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 flex items-center space-x-1.5 transition-colors shrink-0"
              >
                {copiedType === 'joinUrl' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copiedType === 'joinUrl' ? '已複製網址' : '複製網址'}</span>
              </button>
            </div>
          </div>

          {/* Secondary Actions: Direct Download & Stop command */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {/* Direct Exe Download */}
            <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-300 block">手動下載 gs-agent.exe</span>
                <span className="text-[11px] text-slate-500">免指令，直接下載並雙擊執行</span>
              </div>
              <a
                href={`/download/gs-agent.exe`}
                download="gs-agent.exe"
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 text-xs font-bold rounded-lg border border-slate-700 flex items-center space-x-1 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下載</span>
              </a>
            </div>

            {/* Stop Agent Command */}
            <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-300 block">學生端停止連線指令</span>
                <span className="text-[11px] text-slate-500">下課關閉學生背景服務</span>
              </div>
              <button
                onClick={() => handleCopy(stopCommand, 'stop')}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-400 hover:text-rose-300 text-xs font-bold rounded-lg border border-slate-700 flex items-center space-x-1 transition-colors"
              >
                {copiedType === 'stop' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <PowerOff className="w-3.5 h-3.5" />}
                <span>{copiedType === 'stop' ? '已複製' : '複製停止指令'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/40 flex justify-between items-center text-xs text-slate-500">
          <span>提示：學生端程式關機或重開機後會由還原卡自動重設清空</span>
          {!isStandalonePage && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium transition-colors"
            >
              關閉視窗
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
