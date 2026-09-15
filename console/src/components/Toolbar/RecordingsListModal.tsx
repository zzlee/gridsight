import React, { useState, useEffect, useRef } from 'react';
import {
  Film,
  Video,
  User,
  Radio,
  Download,
  Trash2,
  Play,
  X,
  RefreshCw,
  Search,
  HardDrive,
  Clock,
  CheckCircle,
  AlertTriangle,
  FileVideo,
  ExternalLink,
} from 'lucide-react';
import { AuthService } from '../../services/authService';

export interface RecordingFile {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: number;
  downloadUrl: string;
  previewUrl?: string;
}

interface RecordingsListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTeacherRecord?: () => void;
}

export const RecordingsListModal: React.FC<RecordingsListModalProps> = ({
  isOpen,
  onClose,
  onOpenTeacherRecord,
}) => {
  const [recordings, setRecordings] = useState<RecordingFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'teacher' | 'student'>('all');
  const [previewVideo, setPreviewVideo] = useState<{ filename: string; url: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchRecordings = async () => {
    setLoading(true);
    try {
      const res = await AuthService.fetchWithAuth('/api/record/list');
      if (res.ok) {
        const data: RecordingFile[] = await res.json();
        setRecordings(data);
      } else {
        showToast('❌ 無法載入錄影清單');
      }
    } catch {
      showToast('❌ 連線至伺服器失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRecordings();
      setPreviewVideo(null);
    }
  }, [isOpen]);

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`確定要永久刪除錄影檔案「${filename}」嗎？\n此動作將無法復原。`)) return;
    setDeletingFile(filename);
    try {
      const res = await AuthService.fetchWithAuth(`/api/record/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setRecordings((prev) => prev.filter((r) => r.filename !== filename));
        if (previewVideo?.filename === filename) {
          setPreviewVideo(null);
        }
        showToast('🗑️ 錄影檔案已成功刪除');
      } else {
        showToast('❌ 刪除錄影檔案失敗');
      }
    } catch {
      showToast('❌ 連線至伺服器失敗');
    } finally {
      setDeletingFile(null);
    }
  };

  const getRecordingType = (filename: string): 'teacher' | 'student' | 'broadcast' => {
    if (filename.startsWith('GridSight_Student_')) return 'student';
    if (filename.startsWith('GridSight_Broadcast_')) return 'broadcast';
    return 'teacher';
  };

  const parseLabel = (filename: string): { label: string; dateStr: string } => {
    const fn = filename.replace(/\.mp4$/i, '');
    const parts = fn.split('_');
    if (filename.startsWith('GridSight_Student_')) {
      const studentLabel = parts[2] || 'Student';
      const timePart = parts.slice(3).join('_');
      return { label: studentLabel, dateStr: timePart };
    }
    if (filename.startsWith('GridSight_Broadcast_')) {
      return { label: '全體廣播同步', dateStr: parts.slice(2).join('_') };
    }
    if (filename.startsWith('GridSight_Record_')) {
      return { label: '教師獨立錄製', dateStr: parts.slice(2).join('_') };
    }
    return { label: '教學錄影', dateStr: fn };
  };

  // Filtered and searched recordings
  const filteredRecordings = recordings.filter((r) => {
    const type = getRecordingType(r.filename);
    if (filterType === 'teacher' && type === 'student') return false;
    if (filterType === 'student' && type !== 'student') return false;

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return r.filename.toLowerCase().includes(q);
    }
    return true;
  });

  const totalBytes = recordings.reduce((acc, r) => acc + r.sizeBytes, 0);
  const totalFormatted = (totalBytes / (1024 * 1024)).toFixed(1);

  if (!isOpen) return null;

  const token = AuthService.getToken() || '';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 shadow-inner">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-slate-100 text-base">歷史錄影庫</h3>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300">
                  {recordings.length} 部影片 · {totalFormatted} MB
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                包含教師端螢幕錄影、廣播同步存檔與個別學生焦點串流錄製
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="px-6 py-3 bg-slate-950/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Filter Pills */}
          <div className="flex items-center space-x-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                filterType === 'all'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              全部 ({recordings.length})
            </button>
            <button
              onClick={() => setFilterType('teacher')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                filterType === 'teacher'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              教師錄影 ({recordings.filter((r) => getRecordingType(r.filename) !== 'student').length})
            </button>
            <button
              onClick={() => setFilterType('student')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                filterType === 'student'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              學生串流 ({recordings.filter((r) => getRecordingType(r.filename) === 'student').length})
            </button>
          </div>

          {/* Search Box & Refresh */}
          <div className="flex items-center space-x-2 grow sm:grow-0">
            <div className="relative grow sm:w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="搜尋檔案名稱或座號..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>
            <button
              onClick={fetchRecordings}
              disabled={loading}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-700/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
              title="重新整理清單"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Modal Body: Video Player + Recordings List */}
        <div className="p-6 space-y-4 overflow-y-auto grow">
          {/* Embedded Video Preview Player */}
          {previewVideo && (
            <div className="p-4 bg-slate-950 rounded-xl border border-purple-500/40 shadow-xl space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs text-purple-300 font-semibold pb-1">
                <div className="flex items-center space-x-2 truncate">
                  <Play className="w-3.5 h-3.5 text-purple-400 fill-current" />
                  <span className="truncate">{previewVideo.filename}</span>
                </div>
                <div className="flex items-center space-x-3 shrink-0">
                  <a
                    href={`${previewVideo.url}?token=${encodeURIComponent(token)}`}
                    download={previewVideo.filename}
                    className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center space-x-1"
                  >
                    <Download className="w-3 h-3" />
                    <span>下載影片</span>
                  </a>
                  <button
                    onClick={() => setPreviewVideo(null)}
                    className="text-slate-400 hover:text-white transition-colors text-xs font-bold"
                  >
                    關閉播放 ✕
                  </button>
                </div>
              </div>
              <div className="relative rounded-lg overflow-hidden bg-black flex items-center justify-center min-h-[220px] max-h-[360px]">
                <video
                  src={`${previewVideo.url}?token=${encodeURIComponent(token)}`}
                  controls
                  autoPlay
                  className="w-full max-h-[360px] object-contain rounded-lg"
                />
              </div>
            </div>
          )}

          {/* Recordings List */}
          {filteredRecordings.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs space-y-3">
              <FileVideo className="w-12 h-12 mx-auto opacity-30 text-slate-400" />
              {recordings.length === 0 ? (
                <>
                  <p className="text-sm font-semibold text-slate-400">目前尚無任何螢幕錄影檔案</p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    可從頂部「更多工具 ➔ 螢幕錄影」開始錄製教師畫面，或在學生焦點畫面點擊「錄影」按鈕記錄學生操作。
                  </p>
                  {onOpenTeacherRecord && (
                    <button
                      onClick={() => { onClose(); onOpenTeacherRecord(); }}
                      className="mt-2 px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition-all shadow-md"
                    >
                      前往教師螢幕錄影
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400">找不到符合「{searchTerm}」的錄影檔案</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRecordings.map((file) => {
                const recType = getRecordingType(file.filename);
                const info = parseLabel(file.filename);
                const isCurrentPreview = previewVideo?.filename === file.filename;
                const isDeleting = deletingFile === file.filename;

                return (
                  <div
                    key={file.filename}
                    className={`p-3.5 bg-slate-950/60 border rounded-xl flex items-center justify-between text-xs transition-all ${
                      isCurrentPreview
                        ? 'border-purple-500 bg-purple-950/20 shadow-md ring-1 ring-purple-500/30'
                        : 'border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                    }`}
                  >
                    {/* File Meta Info */}
                    <div className="flex items-center space-x-3 truncate mr-3">
                      <div
                        className={`p-2.5 rounded-xl border shrink-0 ${
                          recType === 'student'
                            ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                            : recType === 'broadcast'
                            ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                            : 'bg-red-500/10 border-red-500/30 text-red-400'
                        }`}
                      >
                        {recType === 'student' ? (
                          <User className="w-4 h-4" />
                        ) : recType === 'broadcast' ? (
                          <Radio className="w-4 h-4" />
                        ) : (
                          <Video className="w-4 h-4" />
                        )}
                      </div>

                      <div className="space-y-1 truncate">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                              recType === 'student'
                                ? 'bg-sky-950 text-sky-300 border border-sky-500/30'
                                : recType === 'broadcast'
                                ? 'bg-purple-950 text-purple-300 border border-purple-500/30'
                                : 'bg-red-950 text-red-300 border border-red-500/30'
                            }`}
                          >
                            {recType === 'student'
                              ? `學生: ${info.label}`
                              : recType === 'broadcast'
                              ? '廣播同步'
                              : '教師錄影'}
                          </span>
                          <span className="font-semibold text-slate-200 truncate" title={file.filename}>
                            {file.filename}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-400 font-mono flex items-center space-x-3">
                          <span className="flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span>{new Date(file.createdAt).toLocaleString()}</span>
                          </span>
                          <span className="text-emerald-400 font-bold">{file.sizeFormatted}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        onClick={() =>
                          setPreviewVideo(
                            isCurrentPreview
                              ? null
                              : {
                                  filename: file.filename,
                                  url: file.previewUrl || `/api/record/preview/${encodeURIComponent(file.filename)}`,
                                }
                          )
                        }
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center space-x-1 transition-all shadow-sm ${
                          isCurrentPreview
                            ? 'bg-purple-600 border-purple-500 text-white shadow-purple-950'
                            : 'bg-purple-950/40 hover:bg-purple-900/60 border-purple-500/40 text-purple-300 hover:text-purple-200'
                        }`}
                        title={isCurrentPreview ? '收起預覽' : '在瀏覽器內即時預覽播放'}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span className="hidden sm:inline">{isCurrentPreview ? '播放中' : '預覽'}</span>
                      </button>

                      <a
                        href={`${file.downloadUrl}?token=${encodeURIComponent(token)}`}
                        download={file.filename}
                        className="px-2.5 py-1.5 rounded-lg bg-sky-950/40 hover:bg-sky-900/60 border border-sky-500/40 text-sky-300 hover:text-sky-200 text-xs font-semibold flex items-center space-x-1 transition-colors shadow-sm"
                        title="下載 MP4 檔案到本機"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">下載</span>
                      </a>

                      <button
                        onClick={() => handleDelete(file.filename)}
                        disabled={isDeleting}
                        className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-300 hover:text-red-200 transition-colors shadow-sm"
                        title="刪除此錄影檔案"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Directory & Specification Notice */}
          <div className="p-3.5 bg-slate-950/50 border border-slate-800 rounded-xl text-xs space-y-1.5 text-slate-400 font-mono">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold">
              <HardDrive className="w-4 h-4 text-purple-400" />
              <span>錄影檔案儲存說明</span>
            </div>
            <p>• 檔案皆以 H.264 MP4 格式保存於伺服器 <code>data/recordings/</code> 目錄。</p>
            <p>• 學生串流錄影為原生 NALU 直錄（0% 轉碼損耗），支援離線檢視與教學檢討。</p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400">
            {onOpenTeacherRecord && (
              <button
                onClick={() => { onClose(); onOpenTeacherRecord(); }}
                className="text-purple-400 hover:text-purple-300 flex items-center space-x-1 transition-colors"
              >
                <Video className="w-3.5 h-3.5" />
                <span>開啟教師螢幕錄影控制台</span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors shadow-sm"
          >
            關閉
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-950/95 border border-purple-500/60 text-purple-200 text-xs px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle className="w-4 h-4 text-purple-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
