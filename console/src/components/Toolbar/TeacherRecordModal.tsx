import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  Square,
  X,
  CheckCircle,
  AlertTriangle,
  Download,
  Clock,
  HardDrive,
  Film,
  Trash2,
  RefreshCw,
  Play,
  Radio,
  Mic,
} from 'lucide-react';
import { AuthService } from '../../services/authService';

interface TeacherRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBroadcasting?: boolean;
}

interface RecordingFile {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: number;
  downloadUrl: string;
}

interface ServerRecordStatus {
  isRecording: boolean;
  isRecordOnly: boolean;
  isBroadcasting: boolean;
  filename: string | null;
  fullPath: string | null;
  startTime: number | null;
  durationSeconds: number;
  fileSizeBytes: number;
  audioDevice?: string | null;
}

export const TeacherRecordModal: React.FC<TeacherRecordModalProps> = ({
  isOpen,
  onClose,
  isBroadcasting = false,
}) => {
  const [activeTab, setActiveTab] = useState<'RECORD' | 'FILES'>('RECORD');
  const [status, setStatus] = useState<ServerRecordStatus>({
    isRecording: false,
    isRecordOnly: false,
    isBroadcasting: false,
    filename: null,
    fullPath: null,
    startTime: null,
    durationSeconds: 0,
    fileSizeBytes: 0,
    audioDevice: null,
  });
  const [recordingsList, setRecordingsList] = useState<RecordingFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);

  const [audioDevices, setAudioDevices] = useState<Array<{ id: string; name: string }>>([
    { id: 'none', name: '🔇 不錄製聲音（純視訊）' },
    { id: 'default', name: '🎤 系統預設音訊裝置 (Default)' },
  ]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>(() => {
    return localStorage.getItem('gridsight_record_audio_device') || 'default';
  });
  const [audioLoading, setAudioLoading] = useState(false);

  const [autoRecordBroadcast, setAutoRecordBroadcast] = useState<boolean>(() => {
    return localStorage.getItem('gridsight_auto_record_broadcast') === 'true';
  });

  const pollTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const fetchStatus = async () => {
    try {
      const res = await AuthService.fetchWithAuth('/api/record/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {}
  };

  const fetchRecordingsList = async () => {
    setListLoading(true);
    try {
      const res = await AuthService.fetchWithAuth('/api/record/list');
      if (res.ok) {
        const data = await res.json();
        setRecordingsList(data);
      }
    } catch {
    } finally {
      setListLoading(false);
    }
  };

  // Poll status when recording is active or modal is open
  useEffect(() => {
    fetchStatus();
    if (isOpen || status.isRecording) {
      pollTimerRef.current = window.setInterval(fetchStatus, 1000);
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen, status.isRecording]);

  const fetchAudioDevices = async () => {
    setAudioLoading(true);
    try {
      const res = await AuthService.fetchWithAuth('/api/record/audio-devices');
      if (res.ok) {
        const data = await res.json();
        if (data.devices && Array.isArray(data.devices)) {
          setAudioDevices(data.devices);
        }
      }
    } catch {} finally {
      setAudioLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAudioDevices();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === 'FILES') {
      fetchRecordingsList();
    }
  }, [isOpen, activeTab]);

  const handleToggleAutoRecord = (enabled: boolean) => {
    setAutoRecordBroadcast(enabled);
    localStorage.setItem('gridsight_auto_record_broadcast', enabled ? 'true' : 'false');
  };

  const handleStartRecording = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await AuthService.fetchWithAuth('/api/record/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quality: 'high',
          audioDevice: selectedAudioDevice,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        showToast('🎬 伺服器原生螢幕錄影已啟動 (DXGI + 完整影音)');
      } else {
        const err = await res.json();
        setErrorMsg(err.error || '啟動錄影失敗');
      }
    } catch {
      setErrorMsg('無法連接伺服器');
    } finally {
      setLoading(false);
    }
  };

  const handleStopRecording = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await AuthService.fetchWithAuth('/api/record/stop', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setStatus((s) => ({ ...s, isRecording: false }));
        if (data.fileInfo) {
          const mb = (data.fileInfo.sizeBytes / (1024 * 1024)).toFixed(1);
          showToast(`✅ 錄影已完成並儲存至伺服器：${data.fileInfo.filename} (${mb} MB)`);
        } else {
          showToast('✅ 螢幕錄影已停止');
        }
        fetchRecordingsList();
      } else {
        const err = await res.json();
        setErrorMsg(err.error || '停止錄影失敗');
      }
    } catch {
      setErrorMsg('無法連接伺服器');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRecording = async (filename: string) => {
    if (!window.confirm(`確定要刪除錄影檔案「${filename}」嗎？此動作無法復原。`)) return;
    try {
      const res = await AuthService.fetchWithAuth(`/api/record/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setRecordingsList((list) => list.filter((f) => f.filename !== filename));
        showToast('🗑️ 錄影檔案已刪除');
      }
    } catch {}
  };

  return (
    <>
      {/* Floating Recording OSD (always visible whenever recording is active in background) */}
      {status.isRecording && !isOpen && (
        <div className="fixed top-16 right-5 z-50 bg-slate-950/95 border border-red-500/60 rounded-xl p-3 shadow-2xl backdrop-blur-md flex items-center space-x-3 animate-in fade-in slide-in-from-top-3 duration-200 select-none">
          <div className="flex items-center space-x-2 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-200">
              {status.isBroadcasting ? '廣播同步錄製中' : '教師螢幕錄影中'}
            </span>
            <span className="text-xs font-mono font-bold text-red-400 flex items-center space-x-1">
              <Clock className="w-3 h-3" />
              <span>{formatTime(status.durationSeconds)}</span>
            </span>
            {status.fileSizeBytes > 0 && (
              <span className="text-[11px] font-mono text-slate-400">
                ({(status.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)
              </span>
            )}
            {status.audioDevice && status.audioDevice !== 'none' && (
              <span className="text-[11px] font-mono text-emerald-400 flex items-center space-x-1" title={`錄音來源: ${status.audioDevice}`}>
                <Mic className="w-3 h-3" />
                <span>錄音中</span>
              </span>
            )}
          </div>

          <button
            onClick={handleStopRecording}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white border border-red-500 text-xs font-bold transition-all shadow-md active:scale-95 flex items-center space-x-1.5"
            title="停止螢幕錄製並儲存"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>停止錄影</span>
          </button>
        </div>
      )}

      {/* Main Recording Management Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800 shrink-0">
              <div className="flex items-center space-x-2.5">
                <div className={`p-2 rounded-lg border ${status.isRecording ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                  <Video className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-base flex items-center space-x-2">
                    <span>教師螢幕教學錄影</span>
                    {status.isRecording && (
                      <span className="px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-[10px] font-bold text-red-400 animate-pulse">
                        REC 錄製中
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    採用服務端 DXGI GPU 硬體管線（自帶真實游標、光環波紋與滾輪氣泡特效）
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center border-b border-slate-800 px-5 pt-3 bg-slate-950/60 shrink-0 space-x-4">
              <button
                onClick={() => setActiveTab('RECORD')}
                className={`pb-2.5 text-xs font-semibold border-b-2 transition-all flex items-center space-x-1.5 ${
                  activeTab === 'RECORD'
                    ? 'border-red-500 text-red-400 font-bold'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Video className="w-4 h-4" />
                <span>即時錄製控制</span>
              </button>
              <button
                onClick={() => setActiveTab('FILES')}
                className={`pb-2.5 text-xs font-semibold border-b-2 transition-all flex items-center space-x-1.5 ${
                  activeTab === 'FILES'
                    ? 'border-red-500 text-red-400 font-bold'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Film className="w-4 h-4" />
                <span>歷史錄影清單</span>
                {recordingsList.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300">
                    {recordingsList.length}
                  </span>
                )}
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto grow">
              {errorMsg && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {activeTab === 'RECORD' && (
                <div className="space-y-4">
                  {/* Status Banner */}
                  {status.isRecording ? (
                    <div className="p-4 bg-red-950/30 border border-red-500/40 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-sm font-bold text-red-200">
                            {status.isBroadcasting ? '全體廣播同步錄製中' : '教師端螢幕錄製中'}
                          </span>
                        </div>
                        <div className="flex items-center space-x-1 font-mono text-base font-bold text-red-400 bg-black/40 px-2.5 py-1 rounded-lg border border-red-500/30">
                          <Clock className="w-4 h-4" />
                          <span>{formatTime(status.durationSeconds)}</span>
                        </div>
                      </div>

                      <div className="text-xs text-slate-300 space-y-1 font-mono bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                        <div className="flex justify-between">
                          <span className="text-slate-400">目前存檔名稱：</span>
                          <span className="text-slate-200 truncate max-w-[280px]">{status.filename}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">錄音來源裝置：</span>
                          <span className="text-slate-200 truncate max-w-[280px]">
                            {status.audioDevice && status.audioDevice !== 'none' ? `🎙️ ${status.audioDevice}` : '🔇 純視訊（未錄音）'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">即時檔案大小：</span>
                          <span className="text-emerald-400 font-bold">
                            {(status.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={handleStopRecording}
                        disabled={loading}
                        className="w-full py-2.5 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-bold rounded-lg transition-all shadow-md shadow-red-950 flex items-center justify-center space-x-2"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        <span>停止錄製並完成存檔</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3 text-center">
                      <div className="w-12 h-12 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                        <Video className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-200">
                          {isBroadcasting ? '當前全體廣播進行中' : '準備開始螢幕錄製'}
                        </h4>
                        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                          {isBroadcasting
                            ? '點擊下方按鈕即可同步錄下全體廣播串流（0% 額外效能損耗，內建完整滑鼠特效）。'
                            : '以服務端 DXGI GPU 原生管線在後台錄製教師畫面，老師本機螢幕乾淨無任何遮擋。'}
                        </p>
                      </div>

                      {/* Audio Device Selection (Option 1-A) */}
                      <div className="text-left p-3.5 bg-slate-900 border border-slate-700/80 rounded-lg space-y-2 max-w-md mx-auto">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                            <Mic className="w-3.5 h-3.5 text-sky-400" />
                            <span>聲音來源裝置（僅存檔，不走多播廣播）</span>
                          </label>
                          <button
                            type="button"
                            onClick={fetchAudioDevices}
                            disabled={audioLoading}
                            className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center space-x-1 transition-colors"
                            title="重新偵測音效卡與麥克風"
                          >
                            <RefreshCw className={`w-3 h-3 ${audioLoading ? 'animate-spin' : ''}`} />
                            <span>重新偵測</span>
                          </button>
                        </div>
                        <select
                          value={selectedAudioDevice}
                          onChange={(e) => {
                            setSelectedAudioDevice(e.target.value);
                            localStorage.setItem('gridsight_record_audio_device', e.target.value);
                          }}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
                        >
                          {audioDevices.map((dev) => (
                            <option key={dev.id} value={dev.id}>
                              {dev.name}
                            </option>
                          ))}
                        </select>
                        <div className="text-[11px] text-slate-400 leading-relaxed">
                          💡 選擇「立體聲混音 (Stereo Mix)」可錄入電腦播放的音樂；選擇「麥克風」可錄入老師講課聲音；選「不錄製」則為純畫面。
                        </div>
                      </div>

                      <button
                        onClick={handleStartRecording}
                        disabled={loading}
                        className="px-6 py-2.5 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-bold rounded-lg transition-all shadow-md shadow-red-950 inline-flex items-center space-x-2 mx-auto"
                      >
                        <Video className="w-4 h-4" />
                        <span>{isBroadcasting ? '同步錄製廣播畫面' : '開始螢幕錄影'}</span>
                      </button>
                    </div>
                  )}

                  {/* Settings & Specifications */}
                  <div className="space-y-3">
                    <label className="flex items-center justify-between p-3.5 bg-slate-950/60 border border-slate-800 rounded-lg cursor-pointer hover:border-slate-700 transition-colors">
                      <div className="flex items-center space-x-3">
                        <Radio className="w-5 h-5 text-purple-400 shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-slate-200">全體廣播時自動同步錄影</div>
                          <div className="text-xs text-slate-400">
                            每次點擊「廣播畫面」時自動在後台同步保存 MP4 教學影片
                          </div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoRecordBroadcast}
                        onChange={(e) => handleToggleAutoRecord(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-700 text-purple-600 focus:ring-purple-500 bg-slate-900 cursor-pointer"
                      />
                    </label>

                    <div className="p-3.5 bg-slate-950/40 border border-slate-800/80 rounded-lg text-xs space-y-1.5 text-slate-400 font-mono">
                      <div className="flex items-center space-x-2 text-slate-300 font-semibold">
                        <HardDrive className="w-4 h-4 text-sky-400" />
                        <span>核心管線規格</span>
                      </div>
                      <p>• 影像格式：H.264 MP4 (Fragmented MP4，中斷不壞檔)</p>
                      <p>• 聲音編碼：AAC 128kbps 立體聲 (僅寫入本機 MP4，RTP 多播廣播嚴格過濾靜音)</p>
                      <p>• 滑鼠合成：原生 Windows 游標 + 停頓光環 + 點擊波紋 + 滾輪氣泡 (0ms 幀同步)</p>
                      <p>• 儲存目錄：本機 <code>data/recordings/</code>，任何裝置皆可線上下載</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'FILES' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-xs text-slate-400 font-medium">
                      共 {recordingsList.length} 個錄影檔案
                    </span>
                    <button
                      onClick={fetchRecordingsList}
                      disabled={listLoading}
                      className="text-xs text-sky-400 hover:text-sky-300 flex items-center space-x-1 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${listLoading ? 'animate-spin' : ''}`} />
                      <span>重新整理</span>
                    </button>
                  </div>

                  {recordingsList.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 text-xs space-y-2">
                      <Film className="w-8 h-8 mx-auto opacity-40" />
                      <p>尚未有任何歷史螢幕錄影檔案</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                      {recordingsList.map((file) => (
                        <div
                          key={file.filename}
                          className="p-3 bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 rounded-lg flex items-center justify-between text-xs transition-colors"
                        >
                          <div className="space-y-0.5 truncate mr-3">
                            <div className="font-semibold text-slate-200 truncate" title={file.filename}>
                              {file.filename}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center space-x-3">
                              <span>{new Date(file.createdAt).toLocaleString()}</span>
                              <span className="text-emerald-400 font-bold">{file.sizeFormatted}</span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            <a
                              href={file.downloadUrl}
                              download={file.filename}
                              className="p-2 rounded-lg bg-sky-950/40 hover:bg-sky-900/60 border border-sky-500/40 text-sky-300 hover:text-sky-200 transition-colors"
                              title="下載 MP4 檔案"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                            <button
                              onClick={() => setPreviewVideo(file.downloadUrl)}
                              className="p-2 rounded-lg bg-purple-950/40 hover:bg-purple-900/60 border border-purple-500/40 text-purple-300 hover:text-purple-200 transition-colors"
                              title="預覽播放影片"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteRecording(file.filename)}
                              className="p-2 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-300 hover:text-red-200 transition-colors"
                              title="刪除錄影檔"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Video Preview Popup */}
                  {previewVideo && (
                    <div className="p-3 bg-black/80 rounded-xl border border-purple-500/40 space-y-2 mt-2">
                      <div className="flex items-center justify-between text-xs text-purple-300 font-semibold">
                        <span>影片即時預覽</span>
                        <button
                          onClick={() => setPreviewVideo(null)}
                          className="text-slate-400 hover:text-white"
                        >
                          關閉預覽 ✕
                        </button>
                      </div>
                      <video
                        src={previewVideo}
                        controls
                        autoPlay
                        className="w-full rounded-lg max-h-[220px] bg-black"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-950/95 border border-emerald-500/60 text-emerald-200 text-xs px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </>
  );
};
