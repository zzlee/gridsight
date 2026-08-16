import React from 'react';
import { StudentDevice } from '../../types';
import { WebCodecsPlayer } from './WebCodecsPlayer';
import { X, Maximize, Camera, Volume2, ShieldCheck } from 'lucide-react';

interface FocusModalProps {
  device: StudentDevice | null;
  onClose: () => void;
}

export const FocusModal: React.FC<FocusModalProps> = ({ device, onClose }) => {
  if (!device) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-5xl h-[85vh] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-400 font-mono font-bold text-sm">
              座號 {device.seatNo}
            </span>
            <span className="font-bold text-slate-100 text-base">{device.hostname}</span>
            <span className="text-xs text-slate-400 font-mono">({device.ip})</span>
            <div className="flex items-center space-x-1 text-emerald-400 text-xs px-2 py-0.5 bg-emerald-500/10 rounded border border-emerald-500/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Token 鑑權生效</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="畫面截圖存檔">
              <Camera className="w-4 h-4" />
            </button>
            <button className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="全螢幕">
              <Maximize className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Canvas Area */}
        <div className="flex-1 bg-black overflow-hidden relative">
          <WebCodecsPlayer device={device} />
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>登入使用者: <span className="text-slate-200 font-medium">{device.username}</span> | MAC: <span className="font-mono">{device.mac}</span></div>
          <div className="text-sky-400 font-medium">按需 OpenH264 WebSocket 串流中 (單機約 2~4 Mbps)</div>
        </div>
      </div>
    </div>
  );
};
