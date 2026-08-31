import React, { useState, useRef, useEffect } from 'react';
import { StudentDevice } from '../../types';
import { WebCodecsPlayer, WebCodecsPlayerHandle } from './WebCodecsPlayer';
import { AuthService } from '../../services/authService';
import {
  X,
  Maximize,
  Minimize,
  Camera,
  ShieldCheck,
  Cpu,
  MemoryStick,
  HardDrive,
  Info,
  CheckCircle,
  Activity,
  AppWindow,
  AlertTriangle,
  FileText,
  Download,
  Copy,
  RefreshCw,
  Loader2,
} from 'lucide-react';

interface FocusModalProps {
  device: StudentDevice | null;
  onClose: () => void;
}

export const FocusModal: React.FC<FocusModalProps> = ({ device, onClose }) => {
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<WebCodecsPlayerHandle>(null);
  const [showSpecsHud, setShowSpecsHud] = useState(false); // Default OFF
  const [showDebugHud, setShowDebugHud] = useState(false); // Default OFF
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [snapshotFormat, setSnapshotFormat] = useState<'jpeg' | 'png'>('jpeg');

  // Stream status & Failure log states
  const [streamStatus, setStreamStatus] = useState<'Connecting' | 'Live 30FPS' | 'Snapshot Fallback' | 'Offline'>('Connecting');
  const [packetsReceived, setPacketsReceived] = useState<number>(0);
  const [isStreamTimeout, setIsStreamTimeout] = useState<boolean>(false);

  const [showLogModal, setShowLogModal] = useState<boolean>(false);
  const [logsContent, setLogsContent] = useState<string | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [logError, setLogError] = useState<string | null>(null);

  // Sync fullscreen state with browser events (e.g. Esc key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 3-second stream connection timeout checker
  useEffect(() => {
    setIsStreamTimeout(false);
    const timer = setTimeout(() => {
      setIsStreamTimeout(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [device?.id]);

  if (!device) return null;

  const specs = device.specs;

  const handleToggleFullscreen = async () => {
    if (!modalContainerRef.current) return;
    if (!document.fullscreenElement) {
      try {
        await modalContainerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch (err) {
        console.warn('[FocusModal] Fullscreen error:', err);
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch (err) {
        console.warn('[FocusModal] Exit fullscreen error:', err);
      }
    }
  };

  const handleFetchLogs = async () => {
    if (!device) return;
    setShowLogModal(true);
    setIsLoadingLogs(true);
    setLogError(null);
    try {
      const target = device.mac || device.ip || device.id;
      const resp = await AuthService.fetchWithAuth(`/api/agent/${encodeURIComponent(target)}/logs`);
      if (resp.ok) {
        const text = await resp.text();
        setLogsContent(text);
      } else {
        const errData = await resp.json().catch(() => ({}));
        setLogError(errData.message || errData.error || `無法抓取學生端日誌 (HTTP ${resp.status})`);
      }
    } catch (err: any) {
      console.warn('[FocusModal] Fetch logs error:', err);
      setLogError('連線失敗：目標學生機可能離線或網路被防火牆阻擋。');
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleCopyLogs = () => {
    if (!logsContent) return;
    navigator.clipboard.writeText(logsContent);
    setToastMessage('📋 已複製學生端日誌至剪貼簿');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDownloadLogs = () => {
    if (!logsContent || !device) return;
    const blob = new Blob([logsContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gs-agent-${device.hostname || 'student'}_${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setToastMessage('💾 已下載學生端日誌檔案');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleTakeSnapshot = async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const isJpeg = snapshotFormat === 'jpeg';
    const ext = isJpeg ? 'jpg' : 'png';
    const nameSegment = device.seatNo
      ? (device.seatNo === device.hostname ? device.hostname : `${device.seatNo}_${device.hostname || 'student'}`)
      : (device.hostname || 'student');
    const filename = `GridSight_${nameSegment}_${timestamp}.${ext}`;
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const quality = isJpeg ? 0.85 : undefined;

    // A live rendered frame can be exported directly. During Connecting or
    // Snapshot Fallback, bypass the canvas and request a fresh authenticated
    // full-resolution JPEG capture from the agent.
    const blob = streamStatus === 'Live 30FPS'
      ? await playerRef.current?.captureSnapshot(mimeType, quality) ?? null
      : null;

    if (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const sizeKB = (blob.size / 1024).toFixed(0);
      setToastMessage(`📸 截圖已儲存：${filename} (${sizeKB} KB)`);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    try {
      const resp = await AuthService.fetchWithAuth(
        `/api/snapshot/${encodeURIComponent(device.mac || device.ip)}?full=1&t=${Date.now()}`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const respBlob = await resp.blob();
      const blobUrl = URL.createObjectURL(respBlob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      const sizeKB = (respBlob.size / 1024).toFixed(0);
      setToastMessage(`📸 截圖已儲存：${filename} (${sizeKB} KB)`);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.warn('[FocusModal] Snapshot download failed:', err);
      setToastMessage('❌ 高解析截圖失敗，請檢查 Agent 擷取狀態');
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div
        ref={modalContainerRef}
        className={`relative w-full bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all ${
          isFullscreen ? 'h-full max-w-none rounded-none border-none' : 'max-w-5xl h-[85vh]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <span className={`px-2 py-0.5 rounded font-mono font-bold text-sm border ${
              device.isOffTask
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                : 'bg-sky-500/20 border-sky-500/40 text-sky-400'
            }`}>
              座號 {device.seatNo || '未分配'}
            </span>
            <span className="font-bold text-slate-100 text-base">{device.hostname}</span>
            <span className="text-xs text-slate-400 font-mono">({device.ip})</span>
            {device.activeWindow && (
              <div
                className={`flex items-center space-x-1 text-xs px-2.5 py-0.5 rounded border max-w-xs truncate ${
                  device.isOffTask
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse font-semibold'
                    : 'bg-slate-900 border-slate-800 text-slate-300'
                }`}
                title={`目前操作程式：${device.activeWindow}`}
              >
                {device.isOffTask ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                ) : (
                  <AppWindow className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                )}
                <span className="truncate">{device.activeWindow}</span>
              </div>
            )}
            <div className="flex items-center space-x-1 text-emerald-400 text-xs px-2 py-0.5 bg-emerald-500/10 rounded border border-emerald-500/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>鑑權生效</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {/* Fetch Student Agent Log Button */}
            <button
              onClick={handleFetchLogs}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 hover:border-amber-500/60 transition-colors flex items-center space-x-1 text-xs px-2 font-medium"
              title="抓取學生端失敗紀錄 / gs-agent.log 日誌"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">抓取學生端紀錄</span>
            </button>
            {/* Toggle Stream Diagnostic HUD (Default OFF) */}
            <button
              onClick={() => setShowDebugHud(!showDebugHud)}
              className={`p-1.5 rounded-lg border transition-colors ${
                showDebugHud
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="切換左上角串流除錯資訊 (FPS / 延遲 / 幀型)"
            >
              <Activity className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSpecsHud(!showSpecsHud)}
              className={`p-1.5 rounded-lg border transition-colors ${
                showSpecsHud
                  ? 'bg-sky-600/30 border-sky-500 text-sky-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="切換硬體狀態 HUD 浮層"
            >
              <Info className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSnapshotFormat((f) => (f === 'jpeg' ? 'png' : 'jpeg'))}
              className={`p-1.5 rounded-lg border text-xs font-mono transition-colors ${
                snapshotFormat === 'jpeg'
                  ? 'bg-amber-600/20 border-amber-500/50 text-amber-300'
                  : 'bg-sky-600/20 border-sky-500/50 text-sky-300'
              }`}
              title={`截圖格式：${snapshotFormat.toUpperCase()}（點擊切換）`}
            >
              {snapshotFormat.toUpperCase()}
            </button>
            <button
              onClick={handleTakeSnapshot}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white transition-colors"
              title={`畫面截圖存檔 (下載 ${snapshotFormat.toUpperCase()})`}
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              onClick={handleToggleFullscreen}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title={isFullscreen ? '退出全螢幕' : '全螢幕 (F11)'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 transition-colors"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Canvas Area */}
        <div className="flex-1 bg-black overflow-hidden relative">
          <WebCodecsPlayer
            ref={playerRef}
            device={device}
            showDebugHud={showDebugHud}
            onStreamStatusChange={(status, packets, rendered) => {
              setStreamStatus(status);
              setPacketsReceived(packets);
              if (status === 'Live 30FPS' && (packets > 0 || rendered > 0)) {
                setIsStreamTimeout(false);
              }
            }}
          />

          {/* Stream Failure / No Frames Overlay Banner */}
          {(streamStatus === 'Snapshot Fallback' || streamStatus === 'Offline' || (packetsReceived === 0 && isStreamTimeout)) && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/90 border border-amber-500/50 rounded-xl p-3 px-5 shadow-2xl backdrop-blur-md flex items-center space-x-4 animate-in fade-in slide-in-from-bottom-3 duration-200">
              <div className="flex items-center space-x-2 text-amber-400 font-medium text-xs sm:text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 animate-bounce" />
                <span>尚未收到學生端即時畫面 (連線中斷或串流失敗)</span>
              </div>
              <button
                onClick={handleFetchLogs}
                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md active:scale-95 shrink-0"
              >
                <FileText className="w-4 h-4" />
                <span>抓取學生端失敗紀錄</span>
              </button>
            </div>
          )}

          {/* Toast Notification */}
          {toastMessage && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-sky-950/90 border border-sky-500/50 text-sky-200 text-xs px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md flex items-center space-x-2 animate-in fade-in slide-in-from-top-2 duration-150">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* OSD Hardware Status Floating Overlay */}
          {showSpecsHud && specs && (
            <div className="absolute top-3 right-3 bg-slate-950/85 backdrop-blur-md border border-slate-800/90 rounded-lg p-3 text-xs space-y-2 shadow-xl pointer-events-none max-w-xs animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-slate-300 border-b border-slate-800 pb-1 font-semibold">
                <span className="text-sky-400">學生端硬體即時監控</span>
                <div className="flex items-center space-x-2">
                  {specs.agent_version && (
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      specs.agent_version === __APP_VERSION__
                        ? 'bg-emerald-600/30 text-emerald-300'
                        : 'bg-amber-600/30 text-amber-300'
                    }`} title={
                      specs.agent_version === __APP_VERSION__
                        ? `Agent v${specs.agent_version} ✓ 版本一致`
                        : `⚠️ Agent v${specs.agent_version} ≠ Console v${__APP_VERSION__}`
                    }>
                      Agent v{specs.agent_version}
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-slate-400">{specs.os || 'Windows'}</span>
                </div>
              </div>
              <div className="space-y-1.5 font-mono">
                {/* CPU */}
                <div className="flex items-center justify-between space-x-3">
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <Cpu className="w-3.5 h-3.5 text-sky-400" />
                    <span className="truncate max-w-[120px]" title={specs.cpu.model}>{specs.cpu.model}</span>
                  </div>
                  <span className={`font-bold ${specs.cpu.usage_percent > 80 ? 'text-rose-400' : 'text-slate-200'}`}>
                    {specs.cpu.usage_percent.toFixed(1)}%
                  </span>
                </div>

                {/* RAM */}
                <div className="flex items-center justify-between space-x-3">
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <MemoryStick className="w-3.5 h-3.5 text-emerald-400" />
                    <span>RAM ({Math.round(specs.ram.total_mb / 1024)}GB)</span>
                  </div>
                  <span className={`font-bold ${specs.ram.usage_percent > 85 ? 'text-amber-400' : 'text-slate-200'}`}>
                    {specs.ram.usage_percent.toFixed(1)}%
                  </span>
                </div>

                {/* Disk */}
                <div className="flex items-center justify-between space-x-3">
                  <div className="flex items-center space-x-1.5 text-slate-300">
                    <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                    <span>磁碟 (可用 {specs.disk.free_gb}G)</span>
                  </div>
                  <span className="font-bold text-slate-200">
                    {specs.disk.usage_percent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-3">
            <div>登入者: <span className="text-slate-200 font-medium">{device.username || 'Student'}</span></div>
            <div>MAC: <span className="font-mono text-slate-300">{device.mac}</span></div>
            {device.activeWindow && (
              <div className="flex items-center gap-1">
                <span>視窗:</span>
                <span className={`font-medium ${device.isOffTask ? 'text-rose-400 font-bold' : 'text-slate-200'}`}>
                  {device.activeWindow}
                </span>
              </div>
            )}
          </div>
          <div className="text-sky-400 font-medium">按需 OpenH264 WebSocket 串流中 (單機約 2~4 Mbps)</div>
        </div>

        {/* Student Failure Log Modal */}
        {showLogModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full h-[75vh] flex flex-col overflow-hidden shadow-2xl">
              {/* Log Modal Header */}
              <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800">
                <div className="flex items-center space-x-2.5">
                  <FileText className="w-5 h-5 text-amber-400" />
                  <div>
                    <h3 className="font-bold text-slate-100 text-sm sm:text-base">學生端運行日誌 (gs-agent.log)</h3>
                    <p className="text-xs text-slate-400 font-mono">{device.hostname} ({device.ip})</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {logsContent && (
                    <>
                      <button
                        onClick={handleCopyLogs}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium flex items-center space-x-1 transition-colors"
                        title="複製日誌內容"
                      >
                        <Copy className="w-3.5 h-3.5 text-sky-400" />
                        <span className="hidden sm:inline">複製日誌</span>
                      </button>
                      <button
                        onClick={handleDownloadLogs}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium flex items-center space-x-1 transition-colors"
                        title="下載 .log 檔案"
                      >
                        <Download className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="hidden sm:inline">下載日誌</span>
                      </button>
                    </>
                  )}
                  <button
                    onClick={handleFetchLogs}
                    disabled={isLoadingLogs}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors disabled:opacity-50"
                    title="重新拉取"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => setShowLogModal(false)}
                    className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 transition-colors"
                    title="關閉日誌視窗"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Log Modal Body */}
              <div className="flex-1 p-4 bg-slate-950 overflow-hidden flex flex-col">
                {isLoadingLogs ? (
                  <div className="flex-1 flex flex-col items-center justify-center space-y-3 text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                    <p className="text-xs">正在從學生端 {device.hostname} ({device.ip}) 擷取紀錄檔...</p>
                  </div>
                ) : logError ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
                    <AlertTriangle className="w-10 h-10 text-rose-400 animate-pulse" />
                    <p className="text-slate-200 font-semibold text-sm">{logError}</p>
                    <button
                      onClick={handleFetchLogs}
                      className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-bold transition-all"
                    >
                      重新連線嘗試
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
                    {logsContent || '（學生端日誌內容空白）'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
