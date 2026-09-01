import React from 'react';
import { AppMode, ClassroomLayout } from '../../types';
import { TrafficStats } from '../../services/pollingManager';
import { useState, useEffect, useRef } from 'react';
import { AuthService } from '../../services/authService';
import {
  Edit3,
  Eye,
  Sliders,
  Footprints,
  Landmark,
  HardDrive,
  UserPlus,
  AlertTriangle,
  Lock,
  KeyRound,
  Activity,
  Radio,
  Square,
  Globe,
  FolderUp,
  Clapperboard,
  ChevronDown,
  Power,
  Video,
} from 'lucide-react';

type BroadcastQuality = 'high' | 'medium' | 'low';

const QUALITY_PRESETS: Record<BroadcastQuality, { label: string; desc: string; fps: number; bitrateKbps: number }> = {
  high:   { label: '高',   desc: '1080p · 30FPS · 8Mbps', fps: 30, bitrateKbps: 8000 },
  medium: { label: '中',   desc: '720p · 30FPS · 4Mbps',  fps: 30, bitrateKbps: 4000 },
  low:    { label: '低',   desc: '480p · 15FPS · 1.5Mbps', fps: 15, bitrateKbps: 1500 },
};

interface TopNavProps {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  layout: ClassroomLayout;
  onOpenMatrixConfig: () => void;
  onOpenAisleConfig: () => void;
  onOpenObstacleModal: () => void;
  onOpenDevicePool: () => void;
  onOpenStudentConnect: () => void;
  onOpenAlertSettings?: () => void;
  onOpenShareUrl?: () => void;
  onOpenShareFile?: () => void;
  onOpenBroadcastTest?: () => void;
  onOpenTeacherRecord?: () => void;
  onOpenShutdown?: () => void;
  offTaskCount?: number;
  unassignedCount?: number;
  onLock: () => void;
  onOpenChangePin: () => void;
  trafficStats?: TrafficStats | null;
}

export const TopNav: React.FC<TopNavProps> = ({
  mode,
  setMode,
  layout,
  onOpenMatrixConfig,
  onOpenAisleConfig,
  onOpenObstacleModal,
  onOpenDevicePool,
  onOpenStudentConnect,
  onOpenAlertSettings,
  onOpenShareUrl,
  onOpenShareFile,
  onOpenBroadcastTest,
  onOpenTeacherRecord,
  onOpenShutdown,
  offTaskCount = 0,
  unassignedCount = 0,
  onLock,
  onOpenChangePin,
  trafficStats,
}) => {
  const activeSeatCount = layout.seats.length;
  const cols = layout.cols;
  const rows = layout.rows;

  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastQuality, setBroadcastQuality] = useState<BroadcastQuality>('medium');
  const [broadcastBitrateKbps, setBroadcastBitrateKbps] = useState<number>(0);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const qualityMenuRef = useRef<HTMLDivElement>(null);

  // Check broadcast status periodically
  useEffect(() => {
    const checkBroadcastStatus = async () => {
      try {
        const resp = await AuthService.fetchWithAuth('/api/broadcast/status');
        if (resp.ok) {
          const data = await resp.json();
          const active = !!data.active;
          setIsBroadcasting(active);
          if (data.quality && data.quality in QUALITY_PRESETS) {
            setBroadcastQuality(data.quality);
          }
          setBroadcastBitrateKbps(active ? (data.bitrateKbps || QUALITY_PRESETS[(data.quality || 'medium') as BroadcastQuality]?.bitrateKbps || 4000) : 0);
        }
      } catch {}
    };

    checkBroadcastStatus();
    const interval = setInterval(checkBroadcastStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Close the quality menu on outside click
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target as Node)) {
        setQualityMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const handleToggleBroadcast = async () => {
    setBroadcastLoading(true);
    try {
      if (isBroadcasting) {
        const resp = await AuthService.fetchWithAuth('/api/broadcast/stop', { method: 'POST' });
        if (resp.ok) {
          setIsBroadcasting(false);
        }
      } else {
        const preset = QUALITY_PRESETS[broadcastQuality];
        const resp = await AuthService.fetchWithAuth('/api/broadcast/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quality: broadcastQuality, fps: preset.fps, bitrateKbps: preset.bitrateKbps }),
        });
        if (resp.ok) {
          setIsBroadcasting(true);
        }
      }
    } catch {
    } finally {
      setBroadcastLoading(false);
      setQualityMenuOpen(false);
    }
  };

  return (
    <header className="h-14 bg-slate-950 border-b border-slate-800 px-4 flex items-center justify-between z-30 select-none">
      {/* Left: Brand Title & Classroom Title */}
      <div className="flex items-center space-x-3 shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white shadow-md shadow-sky-600/30">
            GS
          </div>
          <div>
            <div className="font-bold text-slate-100 text-sm tracking-wide">GridSight</div>
            <div className="text-[10px] text-slate-400 font-medium">電腦教室螢幕即時監控系統</div>
          </div>
        </div>

        <div className="h-5 w-px bg-slate-800" />

        <div className="text-xs font-semibold text-slate-300 bg-slate-900 px-2.5 py-1 rounded border border-slate-800 flex items-center space-x-1.5">
          <span>{layout.name}</span>
          <span className="text-[10px] text-sky-400 font-mono">({activeSeatCount}席位)</span>
        </div>
      </div>

      {/* Center: Mode Switcher & Mode-Specific Actions */}
      <div className="flex items-center space-x-3">
        {/* Mode Switcher */}
        <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
          <button
            onClick={() => setMode('MONITOR')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
              mode === 'MONITOR'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>監看模式</span>
          </button>
          <button
            onClick={() => setMode('EDIT_LAYOUT')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
              mode === 'EDIT_LAYOUT'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>佈局編輯</span>
          </button>
        </div>

        <div className="h-5 w-px bg-slate-800" />

        {/* === SCENARIO A: MONITOR MODE (Daily Classroom Teaching) === */}
        {mode === 'MONITOR' && (
          <div className="flex items-center space-x-2.5 animate-in fade-in duration-200">
            {/* Real-time Network Traffic HUD */}
            {trafficStats && (() => {
              const bcastBytesPerSec = isBroadcasting
                ? ((broadcastBitrateKbps || QUALITY_PRESETS[broadcastQuality]?.bitrateKbps || 4000) * 1000) / 8
                : 0;
              const totalBps = (trafficStats.bytesPerSec || 0) + bcastBytesPerSec;
              return (
                <div
                  className="flex items-center space-x-2 px-2.5 py-1 bg-slate-900/90 border border-slate-800 rounded-lg text-xs font-mono shadow-inner"
                  title={isBroadcasting
                    ? `監看縮圖: ${Math.round((trafficStats.bytesPerSec || 0) / 1024)} KB/s + 全體廣播: ${Math.round(bcastBytesPerSec / 1024)} KB/s`
                    : '常態縮圖監看流量'}
                >
                  <div className="flex items-center space-x-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        totalBps > 0
                          ? isBroadcasting ? 'bg-purple-400 animate-pulse' : 'bg-emerald-400 animate-pulse'
                          : 'bg-slate-600'
                      }`}
                    />
                    <span className="text-slate-400 text-[11px]">流量:</span>
                    <span className={`font-bold ${isBroadcasting ? 'text-purple-300' : 'text-emerald-400'}`}>
                      {totalBps >= 1048576
                        ? `${(totalBps / 1048576).toFixed(2)} MB/s`
                        : `${Math.round(totalBps / 1024)} KB/s`}
                    </span>
                    {isBroadcasting && (
                      <span className="text-[10px] text-purple-400 font-sans px-1 py-0.2 bg-purple-950/80 border border-purple-800/60 rounded">
                        廣播
                      </span>
                    )}
                  </div>
                  <span className="text-slate-700">|</span>
                  <div className="text-[11px] text-slate-400">
                    視口: <b className="text-sky-400">{trafficStats.polledCount}</b>/{trafficStats.onlineCount}
                  </div>
                </div>
              );
            })()}

            {/* H.264 RTP Multicast Screen Broadcast Button + Quality Selector */}
            <div ref={qualityMenuRef} className="relative flex items-center">
              {/* Quality drop-down (locked while broadcasting) */}
              <div className="relative">
                <button
                  onClick={() => setQualityMenuOpen((v) => !v)}
                  disabled={isBroadcasting || broadcastLoading}
                  className="flex items-center space-x-1 px-2 py-2.5 rounded-l-lg border border-r-0 border-purple-500/40 bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 hover:text-purple-200 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`廣播品質：${QUALITY_PRESETS[broadcastQuality].desc}${isBroadcasting ? '（廣播中無法切換）' : ''}`}
                >
                  <span>{QUALITY_PRESETS[broadcastQuality].label}</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {qualityMenuOpen && !isBroadcasting && (
                  <div className="absolute top-full left-0 mt-1.5 w-56 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl z-40 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    {(Object.keys(QUALITY_PRESETS) as BroadcastQuality[]).map((q) => (
                      <button
                        key={q}
                        onClick={() => { setBroadcastQuality(q); setQualityMenuOpen(false); }}
                        className={`w-full flex items-center justify-between px-3 py-2.5 text-left border-b border-slate-800/70 last:border-b-0 transition-colors ${
                          q === broadcastQuality
                            ? 'bg-purple-900/40 text-white'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span className="flex items-center space-x-2">
                          <span className="w-5 h-5 rounded-md bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-xs font-bold text-purple-300">
                            {QUALITY_PRESETS[q].label}
                          </span>
                          <span className="text-xs">{QUALITY_PRESETS[q].desc}</span>
                        </span>
                        {q === broadcastQuality && <span className="text-purple-400 text-xs font-bold">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleToggleBroadcast}
                disabled={broadcastLoading}
                className={`flex items-center space-x-1.5 px-3 py-2.5 rounded-r-lg border text-xs font-semibold transition-all active:scale-95 ${
                  isBroadcasting
                    ? 'bg-red-600 hover:bg-red-700 border-red-500 text-white ring-2 ring-red-500/50 shadow-lg shadow-red-950/50 animate-pulse'
                    : 'bg-purple-950/40 hover:bg-purple-900/60 border border-purple-500/40 text-purple-300 hover:text-purple-200'
                }`}
                title={isBroadcasting
                  ? `停止教師畫面全體廣播（${QUALITY_PRESETS[broadcastQuality].desc}）`
                  : `啟動教師畫面全體廣播 (H.264 UDP Multicast · ${QUALITY_PRESETS[broadcastQuality].desc})`}
              >
                {isBroadcasting ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current text-white animate-bounce" />
                    <span>停止廣播</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-3.5 h-3.5 text-purple-400" />
                    <span>廣播畫面</span>
                  </>
                )}
              </button>
            </div>

            {/* Broadcast Test Button (media file/URL -> RTP multicast) */}
            {onOpenBroadcastTest && (
              <button
                onClick={onOpenBroadcastTest}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-fuchsia-950/40 hover:bg-fuchsia-900/60 border border-fuchsia-500/40 text-xs font-semibold text-fuchsia-300 hover:text-fuchsia-200 transition-all shadow-sm active:scale-95"
                title="廣播測試：選定媒體檔案或網址，以 RTP Multicast 串流給學生端測試接收"
              >
                <Clapperboard className="w-3.5 h-3.5 text-fuchsia-400" />
                <span>廣播測試</span>
              </button>
            )}


            {/* Teacher Screen Recording Button */}
            {onOpenTeacherRecord && (
              <button
                onClick={onOpenTeacherRecord}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-xs font-semibold text-red-300 hover:text-red-200 transition-all shadow-sm active:scale-95"
                title="錄製教師畫面與教學過程 (支援麥克風與聲音混合)"
              >
                <Video className="w-3.5 h-3.5 text-red-400" />
                <span>螢幕錄影</span>
              </button>
            )}

            {/* Share URL Button */}
            {onOpenShareUrl && (
              <button
                onClick={onOpenShareUrl}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-sky-950/40 hover:bg-sky-900/60 border border-sky-500/40 text-xs font-semibold text-sky-300 hover:text-sky-200 transition-all shadow-sm active:scale-95"
                title="廣播傳送網址給學生端 (自動開啟預設瀏覽器)"
              >
                <Globe className="w-3.5 h-3.5 text-sky-400" />
                <span>分享網址</span>
              </button>
            )}

            {/* Share File Button */}
            {onOpenShareFile && (
              <button
                onClick={onOpenShareFile}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/40 text-xs font-semibold text-amber-300 hover:text-amber-200 transition-all shadow-sm active:scale-95"
                title="廣播傳送檔案給學生端 (下載至 Downloads 並開啟檔案總管)"
              >
                <FolderUp className="w-3.5 h-3.5 text-amber-400" />
                <span>分享檔案</span>
              </button>
            )}

            {/* Quick Student Connect / Join Instruction Modal */}
            <button
              onClick={onOpenStudentConnect}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/40 text-xs font-semibold text-emerald-300 hover:text-emerald-200 transition-all shadow-sm active:scale-95"
              title="學生端一鍵連線指引 (Win + R 快速加入)"
            >
              <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>學生端連線</span>
            </button>

            {/* Broadcast Shutdown Button */}
            {onOpenShutdown && (
              <button
                onClick={onOpenShutdown}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/40 text-xs font-semibold text-rose-300 hover:text-rose-200 transition-all shadow-sm active:scale-95"
                title="廣播關閉學生端電腦 (觸發倒數計時關機畫面)"
              >
                <Power className="w-3.5 h-3.5 text-rose-400" />
                <span>廣播關機</span>
              </button>
            )}

            {/* High-Visibility Off-Task Alert Button */}
            {onOpenAlertSettings && (
              <button
                onClick={onOpenAlertSettings}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 ${
                  offTaskCount > 0
                    ? 'bg-rose-600/25 hover:bg-rose-600/35 border-rose-500 text-rose-200 ring-2 ring-rose-500/30 shadow-lg shadow-rose-950 animate-pulse'
                    : 'bg-amber-950/30 hover:bg-amber-900/50 border-amber-500/40 text-amber-300 hover:text-amber-200'
                }`}
                title="課堂離題關鍵字警示管理 (點擊自訂關鍵字或查看違規名單)"
              >
                <AlertTriangle className={`w-4 h-4 ${offTaskCount > 0 ? 'text-rose-400 animate-bounce' : 'text-amber-400'}`} />
                <span className="font-bold">離題警示</span>
                {offTaskCount > 0 ? (
                  <span className="px-2 py-0.2 rounded-full bg-rose-600 text-white font-mono text-[11px] font-extrabold shadow">
                    {offTaskCount} 台
                  </span>
                ) : (
                  <span className="text-[10px] text-amber-400/80 font-mono font-medium">
                    (正常)
                  </span>
                )}
              </button>
            )}
          </div>
        )}

        {/* === SCENARIO B: EDIT LAYOUT MODE (Initial Setup & Customization) === */}
        {mode === 'EDIT_LAYOUT' && (
          <div className="flex items-center space-x-2 animate-in fade-in duration-200">
            {/* Matrix Dimensions Button (X × Y Standard Matrix) */}
            <button
              onClick={onOpenMatrixConfig}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white transition-colors"
              title="自訂 X × Y 矩陣尺寸"
            >
              <Sliders className="w-3.5 h-3.5 text-sky-400" />
              <span>矩陣 ({cols}×{rows})</span>
            </button>

            {/* Aisles Division Configuration */}
            <button
              onClick={onOpenAisleConfig}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white transition-colors"
              title="走道劃分設定 (Aisles)"
            >
              <Footprints className="w-3.5 h-3.5 text-sky-400" />
              <span>走道 ({layout.aisles?.length || 0})</span>
            </button>

            {/* Obstacles & Teacher Podium Configuration */}
            <button
              onClick={onOpenObstacleModal}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white transition-colors"
              title="講台與障礙物管理 (Obstacles)"
            >
              <Landmark className="w-3.5 h-3.5 text-amber-400" />
              <span>講台/障礙物 ({layout.obstacles?.length || 0})</span>
            </button>

            {/* Device Pool Button with unassigned badge */}
            <button
              onClick={onOpenDevicePool}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white relative"
              title="開啟待分配設備池"
            >
              <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
              <span>設備池</span>
              {unassignedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-bold text-[10px]">
                  {unassignedCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Right: Security PIN settings & Lock Console */}
      <div className="flex items-center space-x-2 shrink-0">
        <button
          onClick={onOpenChangePin}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors text-xs font-semibold"
          title="修改教師安全 PIN 碼"
        >
          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
          <span>PIN 碼設定</span>
        </button>

        <button
          onClick={onLock}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-xs font-semibold transition-all shadow-sm"
          title="離開座位鎖定控制台"
        >
          <Lock className="w-3.5 h-3.5 text-rose-400" />
          <span>鎖定控制台</span>
        </button>
      </div>
    </header>
  );
};
