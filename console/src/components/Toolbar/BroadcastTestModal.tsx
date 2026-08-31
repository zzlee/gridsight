import React, { useState, useEffect, useRef } from 'react';
import { AuthService } from '../../services/authService';
import { Clapperboard, X, Send, Square, FileVideo, Link2, UploadCloud, AlertCircle, CheckCircle2, Loader2, Video } from 'lucide-react';

const DEFAULT_TEST_URL = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4';

type TestQuality = 'high' | 'medium' | 'low' | 'custom';

const QUALITY_PRESETS: Record<Exclude<TestQuality, 'custom'>, { label: string; desc: string; fps: number; bitrateKbps: number; scale: number }> = {
  high:   { label: '高', desc: '1080p · 30FPS · 8Mbps',  fps: 30, bitrateKbps: 8000, scale: 1080 },
  medium: { label: '中', desc: '720p · 30FPS · 4Mbps',   fps: 30, bitrateKbps: 4000, scale: 720 },
  low:    { label: '低', desc: '480p · 15FPS · 1.5Mbps', fps: 15, bitrateKbps: 1500, scale: 540 },
};

interface BroadcastTestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BroadcastTestModal: React.FC<BroadcastTestModalProps> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<'url' | 'file'>('url');
  const [mediaUrl, setMediaUrl] = useState(DEFAULT_TEST_URL);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loop, setLoop] = useState(true);
  const [quality, setQuality] = useState<TestQuality>('medium');
  const [resolution, setResolution] = useState<'auto' | 540 | 720 | 1080>(720);
  const [fps, setFps] = useState<number>(30);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setSuccessMsg('');
      checkStatus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(checkStatus, 2500);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const checkStatus = async () => {
    try {
      const resp = await AuthService.fetchWithAuth('/api/broadcast/status');
      if (resp.ok) {
        const data = await resp.json();
        setActive(!!data.active);
        setMode(data.mode ?? null);
      }
    } catch {}
  };

  const handleUpload = async (file: File): Promise<void> => {
    setUploading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const token = AuthService.getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch('/api/broadcast/test-media', { method: 'POST', headers, body: file });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        setUploadedPath(data.filePath ?? '');
        setErrorMsg('');
      } else {
        setUploadedPath('');
        setErrorMsg(data.error || `檔案上傳失敗 (HTTP ${resp.status})`);
      }
    } catch {
      setUploadedPath('');
      setErrorMsg('上傳失敗，請檢查網路連線');
    } finally {
      setUploading(false);
    }
  };

  const startTest = async () => {
    if (tab === 'file' && !uploadedPath) {
      setErrorMsg('請先選擇並上傳一個媒體檔案');
      return;
    }
    if (tab === 'url' && !mediaUrl.trim()) {
      setErrorMsg('請輸入測試媒體網址');
      return;
    }
    setIsStarting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const sourceType = tab;
      const source = tab === 'file' ? uploadedPath : mediaUrl.trim();
      const scale = resolution === 'auto' ? 1080 : resolution;
      const payload =
        quality !== 'custom'
          ? { sourceType, source, quality, loop }
          : { sourceType, source, fps, bitrateKbps: 3000, scale, loop };
      const resp = await AuthService.fetchWithAuth('/api/broadcast/test/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.active) {
        setActive(true);
        setMode(data.mode ?? null);
        setSuccessMsg(data.alreadyActive ? '廣播測試已在串流中' : '廣播測試已開始串流！請至學生端確認接收畫面');
      } else {
        setActive(false);
        setErrorMsg(data.error || `廣播測試啟動失敗 (HTTP ${resp.status})`);
      }
    } catch {
      setErrorMsg('無法連線至伺服器');
    } finally {
      setIsStarting(false);
    }
  };

  const stopTest = async () => {
    setIsStopping(true);
    setErrorMsg('');
    try {
      const resp = await AuthService.fetchWithAuth('/api/broadcast/test/stop', { method: 'POST' });
      if (resp.ok) {
        setActive(false);
        setMode(null);
        setSuccessMsg('廣播測試已停止');
      }
    } catch {
      setErrorMsg('停止廣播失敗');
    } finally {
      setIsStopping(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setUploadedPath('');
      setErrorMsg('');
      handleUpload(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setUploadedPath('');
      setErrorMsg('');
      handleUpload(file);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20">
              <Clapperboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">廣播測試 (RTP Multicast)</h3>
              <p className="text-xs text-slate-400">選定媒體串流給學生端，測試學生接收功能</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Status Banner */}
        <div className={`mx-6 mt-4 px-3 py-2 rounded-xl flex items-center justify-between text-xs border ${
          active
            ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
            : 'bg-slate-950/60 border-slate-800 text-slate-400'
        }`}>
          <div className="flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span>{active ? `串流中 (${mode === 'url' ? '網址' : mode === 'file' ? '本機檔案' : '畫面'})` : '目前未在串流'}</span>
          </div>
          {active && (
            <button
              onClick={stopTest}
              disabled={isStopping}
              className="flex items-center space-x-1 px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-50"
            >
              {isStopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-current" />}
              <span>停止</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="mx-6 mt-4 flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
          <button
            onClick={() => setTab('url')}
            className={`flex flex-1 items-center justify-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              tab === 'url' ? 'bg-fuchsia-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>媒體網址 (URL)</span>
          </button>
          <button
            onClick={() => setTab('file')}
            className={`flex flex-1 items-center justify-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              tab === 'file' ? 'bg-fuchsia-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileVideo className="w-3.5 h-3.5" />
            <span>本機媒體檔案</span>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {tab === 'url' ? (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">測試媒體網址</label>
              <input
                type="text"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://.../video.mp4"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-fuchsia-500 focus:outline-none text-xs text-slate-200 placeholder-slate-600"
              />
              <div className="flex items-center space-x-2 text-[11px] text-slate-500 pt-1">
                <Video className="w-3.5 h-3.5" />
                <span>可下載測試影片:</span>
                <span className="text-fuchsia-400/90 break-all font-mono">{DEFAULT_TEST_URL}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">選擇本機媒體檔案</label>
              <input ref={fileInputRef} type="file" accept="video/*,audio/*,.mp4,.mkv,.webm,.mov,.ts,.mp3,.wav" onChange={handleFileChange} className="hidden" />
              {!selectedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                    isDragging ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-800/50'
                  }`}
                >
                  <UploadCloud className="w-8 h-8 text-fuchsia-400 mb-2 animate-bounce" />
                  <p className="text-xs font-semibold text-slate-200">點擊選擇檔案 或 拖曳至此</p>
                  <p className="text-[11px] text-slate-500 mt-1">上傳至教師端伺服器後以 RTP 多播串流</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-2xl">
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <div className="p-2 rounded-xl bg-fuchsia-500/10 text-fuchsia-400 shrink-0">
                        <FileVideo className="w-5 h-5" />
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-semibold text-slate-200 truncate">{selectedFile.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono">{(selectedFile.size / 1048576).toFixed(1)} MB</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSelectedFile(null); setUploadedPath(''); }}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {uploading && (
                    <div className="flex items-center space-x-2 text-xs text-fuchsia-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>正在上傳至伺服器...</span>
                    </div>
                  )}
                  {uploadedPath && !uploading && (
                    <div className="flex items-center space-x-2 text-xs text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>上傳完成，可開始廣播測試</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error / Success */}
          {errorMsg && (
            <div className="flex items-center space-x-2 p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="flex items-center space-x-2 p-3 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-xs animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Stream Settings */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">廣播品質</label>
              <div className="grid grid-cols-4 gap-1.5">
                {([...(['high', 'medium', 'low'] as const).map((q) => [QUALITY_PRESETS[q].label, q] as const), ['自訂', 'custom'] as const]).map(([label, val]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setQuality(val as TestQuality)}
                    title={val === 'custom' ? '手動指定解析度與 FPS' : `${QUALITY_PRESETS[val as Exclude<TestQuality, 'custom'>]?.desc ?? ''}`}
                    className={`py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
                      quality === val
                        ? 'bg-fuchsia-600 border-fuchsia-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {quality !== 'custom' && (
                <p className="text-[11px] text-fuchsia-300/90">{QUALITY_PRESETS[quality as Exclude<TestQuality, 'custom'>].desc}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">測試解析度</label>
              <div className="grid grid-cols-4 gap-1.5">
                {([['540', 540], ['720', 720], ['1080', 1080], ['原始', 'auto']] as const).map(([label, val]) => (
                  <button
                    key={String(val)}
                    type="button"
                    disabled={quality !== 'custom'}
                    onClick={() => setResolution(val)}
                    className={`py-1.5 rounded-lg border text-[11px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      resolution === val
                        ? 'bg-fuchsia-600 border-fuchsia-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">FPS</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[24, 30, 60].map((f) => (
                  <button
                    key={f}
                    type="button"
                    disabled={quality !== 'custom'}
                    onClick={() => setFps(f)}
                    className={`py-1.5 rounded-lg border text-[11px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      fps === f
                        ? 'bg-fuchsia-600 border-fuchsia-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">提示：品質越低（解析度/碼率/FPS 越低），學生端解碼負擔越小，實測越穩定。選擇「自訂」可手動指定解析度與 FPS。</p>

          {/* Action */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              關閉
            </button>
            {!active && (
              <button
                onClick={startTest}
                disabled={isStarting || uploading || (tab === 'file' && !uploadedPath)}
                className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold text-xs transition-all shadow-lg shadow-fuchsia-600/30 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{isStarting ? '啟動中...' : '開始廣播測試'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
