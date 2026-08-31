import React, { useState, useEffect, useCallback } from 'react';
import { StudentDevice, DeviceSystemInfo } from '../../types';
import { X, Cpu, HardDrive, MemoryStick, Activity, Clock, Laptop, ShieldCheck, RefreshCw, AlertTriangle, Info } from 'lucide-react';

interface DeviceSpecsModalProps {
  device: StudentDevice | null;
  onClose: () => void;
}

export const DeviceSpecsModal: React.FC<DeviceSpecsModalProps> = ({ device, onClose }) => {
  const [liveSpecs, setLiveSpecs] = useState<DeviceSystemInfo | null>(device?.specs || null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (device && device.specs) {
      setLiveSpecs(device.specs);
    }
  }, [device]);

  if (!device) return null;

  const specs = liveSpecs || device.specs;

  const formatUptime = (seconds?: number) => {
    if (!seconds) return '未知';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs} 小時 ${mins} 分鐘`;
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 90) return 'bg-rose-500';
    if (percent >= 75) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950/80 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <span className="px-2.5 py-1 rounded bg-sky-500/20 border border-sky-500/40 text-sky-400 font-mono font-bold text-sm">
              {device.seatNo || '未分配'}
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                <span>{device.hostname}</span>
                <span className="text-xs font-mono font-normal text-slate-400">({device.ip})</span>
              </h2>
              <p className="text-xs text-slate-400">
                登入者: <span className="text-slate-200">{device.username || 'Student'}</span> | MAC: <span className="font-mono">{device.mac}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="關閉"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {specs ? (
            <>
              {/* Top Overview Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg flex items-center space-x-3">
                  <div className="p-2 rounded-md bg-indigo-500/10 text-indigo-400">
                    <Laptop className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">作業系統</div>
                    <div className="text-sm font-semibold text-slate-200 truncate" title={specs.os || 'Windows'}>
                      {specs.os || 'Windows 11 (x64)'}
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/50 border border-slate-800/80 rounded-lg flex items-center space-x-3">
                  <div className="p-2 rounded-md bg-amber-500/10 text-amber-400">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">已開機運行</div>
                    <div className="text-sm font-semibold text-slate-200 font-mono">
                      {formatUptime(specs.uptime)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Agent Version */}
              {specs.agent_version && (
                <div className={`p-3 border rounded-lg flex items-center space-x-3 ${
                  specs.agent_version === __APP_VERSION__
                    ? 'bg-slate-950/50 border-emerald-800/60'
                    : 'bg-amber-950/30 border-amber-700/60'
                }`}>
                  <div className={`p-2 rounded-md ${
                    specs.agent_version === __APP_VERSION__
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    <Info className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[11px] text-slate-400">Agent 版本</div>
                    <div className="text-sm font-semibold font-mono text-slate-200">
                      v{specs.agent_version}
                      {specs.agent_version === __APP_VERSION__ ? (
                        <span className="ml-2 text-emerald-400 text-xs">✓ 版本一致</span>
                      ) : (
                        <span className="ml-2 text-amber-400 text-xs">⚠️ 與 Console v{__APP_VERSION__} 不符</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* CPU Hardware Status */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-sky-400 font-medium text-sm">
                    <Cpu className="w-4 h-4" />
                    <span>處理器 (CPU)</span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-slate-200">
                    {specs.cpu.usage_percent.toFixed(1)}%
                  </span>
                </div>
                <div className="text-xs text-slate-300 font-mono truncate" title={specs.cpu.model}>
                  {specs.cpu.model} ({specs.cpu.cores} 核心)
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getProgressColor(specs.cpu.usage_percent)}`}
                    style={{ width: `${Math.min(100, Math.max(0, specs.cpu.usage_percent))}%` }}
                  />
                </div>
              </div>

              {/* RAM Hardware Status */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-emerald-400 font-medium text-sm">
                    <MemoryStick className="w-4 h-4" />
                    <span>記憶體 (RAM)</span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-slate-200">
                    {specs.ram.usage_percent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-400 font-mono">
                  <span>已用: {Math.round((specs.ram.total_mb - specs.ram.avail_mb) / 1024 * 10) / 10} GB</span>
                  <span>總量: {Math.round(specs.ram.total_mb / 1024 * 10) / 10} GB (剩餘 {(specs.ram.avail_mb / 1024).toFixed(1)} GB)</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getProgressColor(specs.ram.usage_percent)}`}
                    style={{ width: `${Math.min(100, Math.max(0, specs.ram.usage_percent))}%` }}
                  />
                </div>
              </div>

              {/* Disk Hardware Status */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-purple-400 font-medium text-sm">
                    <HardDrive className="w-4 h-4" />
                    <span>系統磁碟 ({specs.disk.drive})</span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-slate-200">
                    {specs.disk.usage_percent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-400 font-mono">
                  <span>已用: {specs.disk.total_gb - specs.disk.free_gb} GB</span>
                  <span>總容量: {specs.disk.total_gb} GB (可用 {specs.disk.free_gb} GB)</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getProgressColor(specs.disk.usage_percent)}`}
                    style={{ width: `${Math.min(100, Math.max(0, specs.disk.usage_percent))}%` }}
                  />
                </div>
              </div>
            </>
          ) : errorMsg ? (
            <div className="p-6 bg-rose-950/20 border border-rose-900/50 rounded-lg text-center space-y-3">
              <div className="p-3 bg-rose-500/10 rounded-full w-12 h-12 flex items-center justify-center mx-auto text-rose-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-rose-300">硬體資訊讀取失敗</h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto">{errorMsg}</p>
              
              <div className="p-3 bg-slate-950/80 rounded border border-slate-800 text-left text-xs text-slate-300 space-y-1.5 font-mono">
                <p className="text-sky-400 font-semibold">排查建議：</p>
                <p>1. 請確認學生端代理程式 (gs-agent.exe) 是否正在背景執行。</p>
                <p>2. 確認學生機與教師控制台位於同一區域網路。</p>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 space-y-3">
              <Activity className="w-8 h-8 mx-auto text-slate-600 animate-pulse" />
              <p className="text-sm">等待學生端推播硬體狀態資訊...</p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-1.5 text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <span>動態 RAM Token 連線正常</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
