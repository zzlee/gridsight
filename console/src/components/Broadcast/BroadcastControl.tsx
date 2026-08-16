import React from 'react';
import { BroadcastConfig } from '../../types';
import { Radio, Play, Square, Wifi } from 'lucide-react';

interface BroadcastControlProps {
  config: BroadcastConfig;
  onToggleBroadcast: () => void;
}

export const BroadcastControl: React.FC<BroadcastControlProps> = ({
  config,
  onToggleBroadcast,
}) => {
  return (
    <div className={`flex items-center space-x-3 px-3 py-1.5 rounded-lg border transition-all ${
      config.active
        ? 'bg-rose-950/40 border-rose-600/60 shadow-lg shadow-rose-900/30 text-rose-200 animate-pulse'
        : 'bg-slate-900 border-slate-800 text-slate-300'
    }`}>
      <div className="flex items-center space-x-2">
        <Radio className={`w-4 h-4 ${config.active ? 'text-rose-400 animate-ping' : 'text-slate-400'}`} />
        <span className="text-xs font-semibold">
          {config.active ? '教師畫面全體廣播中' : '全體廣播 (UDP Multicast)'}
        </span>
      </div>

      {config.active && (
        <div className="text-[11px] font-mono text-rose-300 flex items-center space-x-2 bg-rose-900/40 px-2 py-0.5 rounded border border-rose-700/50">
          <span>{config.multicastIp}:{config.port}</span>
          <span>•</span>
          <span>1080p @ {config.fps}fps</span>
          <span>•</span>
          <span>{config.bitrateKbps / 1000} Mbps</span>
        </div>
      )}

      <button
        onClick={onToggleBroadcast}
        className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow ${
          config.active
            ? 'bg-rose-600 hover:bg-rose-700 text-white'
            : 'bg-sky-600 hover:bg-sky-500 text-white'
        }`}
      >
        {config.active ? (
          <>
            <Square className="w-3.5 h-3.5" />
            <span>停止廣播</span>
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5" />
            <span>開始廣播</span>
          </>
        )}
      </button>
    </div>
  );
};
