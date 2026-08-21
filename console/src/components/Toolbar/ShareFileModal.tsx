import React, { useState, useEffect, useRef } from 'react';
import { AuthService } from '../../services/authService';
import { FolderUp, X, Send, CheckCircle2, AlertCircle, Laptop, File, UploadCloud } from 'lucide-react';

interface ShareFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTargets?: string[];
  selectedCount?: number;
  totalOnlineCount?: number;
}

export const ShareFileModal: React.FC<ShareFileModalProps> = ({
  isOpen,
  onClose,
  selectedTargets = [],
  selectedCount = 0,
  totalOnlineCount = 0,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sendToAll, setSendToAll] = useState(selectedCount === 0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null);
      setErrorMsg('');
      setSuccessMsg('');
      setSendToAll(selectedCount === 0);
    }
  }, [isOpen, selectedCount]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
      setErrorMsg('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFile(e.dataTransfer.files[0]);
      setErrorMsg('');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMsg('請先選擇要分享的檔案');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const targets = sendToAll || selectedCount === 0 ? [] : selectedTargets;
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'x-filename': encodeURIComponent(selectedFile.name),
        'x-targets': JSON.stringify(targets),
      };

      const resp = await AuthService.fetchWithAuth('/api/share/file', {
        method: 'POST',
        headers,
        body: selectedFile,
      });

      const data = await resp.json();
      if (resp.ok && data.success) {
        setSuccessMsg(data.message || `檔案已成功發送！學生機下載後將自動開啟檔案總管`);
        setTimeout(() => {
          onClose();
        }, 1800);
      } else {
        setErrorMsg(data.error || '檔案分享失敗');
      }
    } catch (err) {
      setErrorMsg('傳送失敗，請檢查網路連線或伺服器狀態');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <FolderUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">分享檔案給學生</h3>
              <p className="text-xs text-slate-400">學生端下載至「下載」目錄後自動開啟檔案總管</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Target Audience Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">發送對象</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSendToAll(true)}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  sendToAll
                    ? 'bg-amber-600/20 border-amber-500 text-amber-300 shadow-md shadow-amber-950/50'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <Laptop className="w-4 h-4 text-amber-400" />
                <span>全班學生 ({totalOnlineCount} 台)</span>
              </button>

              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={() => setSendToAll(false)}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  selectedCount === 0
                    ? 'opacity-40 cursor-not-allowed bg-slate-950/30 border-slate-800 text-slate-500'
                    : !sendToAll
                    ? 'bg-amber-600/20 border-amber-500 text-amber-300 shadow-md shadow-amber-950/50'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <Laptop className="w-4 h-4 text-emerald-400" />
                <span>已選取 ({selectedCount} 台)</span>
              </button>
            </div>
          </div>

          {/* Drag & Drop File Picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">選擇檔案</label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
            />

            {!selectedFile ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                  isDragging
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-800/50'
                }`}
              >
                <UploadCloud className="w-8 h-8 text-amber-400 mb-2 animate-bounce" />
                <p className="text-xs font-semibold text-slate-200">點擊選擇檔案 或 拖曳檔案至此</p>
                <p className="text-[11px] text-slate-500 mt-1">支援各種文件、圖片、壓縮檔與專案檔</p>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800 rounded-2xl">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                    <File className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-xs font-semibold text-slate-200 truncate">{selectedFile.name}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{formatFileSize(selectedFile.size)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Error / Success Feedback */}
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

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isLoading || !selectedFile}
              className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-amber-600/30 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              <Send className="w-4 h-4" />
              <span>{isLoading ? '傳送中...' : '發送檔案給學生'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
