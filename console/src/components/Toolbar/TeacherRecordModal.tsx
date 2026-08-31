import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Square,
  Pause,
  Play,
  X,
  CheckCircle,
  AlertTriangle,
  Download,
  Clock,
  HardDrive,
} from 'lucide-react';

interface TeacherRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TeacherRecordModal: React.FC<TeacherRecordModalProps> = ({ isOpen, onClose }) => {
  const [includeMic, setIncludeMic] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  // Timer formatted as HH:MM:SS or MM:SS
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Clean up timer and streams when component unmounts
  useEffect(() => {
    return () => {
      stopRecordingCleanup();
    };
  }, []);

  const stopRecordingCleanup = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const getSupportedMimeType = (): string => {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4',
    ];
    for (const type of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'video/webm';
  };

  const handleStartRecording = async () => {
    setErrorMsg(null);
    recordedChunksRef.current = [];

    try {
      // 1. Capture teacher screen
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as any,
        audio: true, // Request system audio if supported by browser
      });

      streamRef.current = displayStream;

      const videoTrack = displayStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('未取得螢幕視訊軌');
      }

      // Handle user stopping screen share via browser OSD banner
      videoTrack.onended = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          handleStopRecording();
        }
      };

      let finalStream = displayStream;

      // 2. Capture microphone if enabled & combine audio tracks
      if (includeMic) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = micStream;

          const displayAudioTrack = displayStream.getAudioTracks()[0];
          const micAudioTrack = micStream.getAudioTracks()[0];

          if (displayAudioTrack || micAudioTrack) {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioCtx;
            const dest = audioCtx.createMediaStreamDestination();

            if (displayAudioTrack) {
              const displaySource = audioCtx.createMediaStreamSource(new MediaStream([displayAudioTrack]));
              displaySource.connect(dest);
            }

            if (micAudioTrack) {
              const micSource = audioCtx.createMediaStreamSource(new MediaStream([micAudioTrack]));
              micSource.connect(dest);
            }

            const combinedTracks = [videoTrack, ...dest.stream.getAudioTracks()];
            finalStream = new MediaStream(combinedTracks);
          }
        } catch (micErr) {
          console.warn('[TeacherRecordModal] Could not capture microphone:', micErr);
          setErrorMsg('麥克風存取失敗，將繼續錄製無麥克風畫面。');
        }
      }

      // 3. Setup MediaRecorder
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(finalStream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        saveRecordedFile(mimeType);
        stopRecordingCleanup();
        setIsRecording(false);
        setIsPaused(false);
      };

      recorder.start(1000); // Collect slice every 1 sec
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);
      onClose(); // Hide main config modal during recording

      // Start timer
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch (err: any) {
      console.warn('[TeacherRecordModal] Start recording failed:', err);
      if (err.name !== 'NotAllowedError') {
        setErrorMsg(err.message || '啟動螢幕錄影失敗，請確認瀏覽器支援與權限。');
      }
    }
  };

  const handlePauseResume = () => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      stopRecordingCleanup();
      setIsRecording(false);
      setIsPaused(false);
    }
  };

  const saveRecordedFile = (mimeType: string) => {
    const chunks = recordedChunksRef.current;
    if (chunks.length === 0) return;

    const blob = new Blob(chunks, { type: mimeType });
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `GridSight_Teacher_Record_${timestamp}.${ext}`;
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setToastMessage(`🎥 教師畫面錄影已儲存：${filename} (${sizeMB} MB)`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <>
      {/* Configuration Modal when opening recording setup */}
      {isOpen && !isRecording && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                  <Video className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-base">教師螢幕教學錄影</h3>
                  <p className="text-xs text-slate-400">錄製教師畫面與聲音教學過程</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 space-y-4">
              {errorMsg && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Options */}
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3.5 bg-slate-950/60 border border-slate-800 rounded-lg cursor-pointer hover:border-slate-700 transition-colors">
                  <div className="flex items-center space-x-3">
                    {includeMic ? (
                      <Mic className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <MicOff className="w-5 h-5 text-slate-400" />
                    )}
                    <div>
                      <div className="text-sm font-semibold text-slate-200">同步錄製教師麥克風聲音</div>
                      <div className="text-xs text-slate-400">開啟後將混合螢幕音訊與麥克風聲音</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={includeMic}
                    onChange={(e) => setIncludeMic(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 text-red-600 focus:ring-red-500 bg-slate-900 cursor-pointer"
                  />
                </label>

                <div className="p-3.5 bg-slate-950/40 border border-slate-800/80 rounded-lg text-xs space-y-1.5 text-slate-400 font-mono">
                  <div className="flex items-center space-x-2 text-slate-300 font-semibold">
                    <HardDrive className="w-4 h-4 text-sky-400" />
                    <span>輸出格式與儲存</span>
                  </div>
                  <p>• 自動偵測瀏覽器最高相容格式 (WebM / VP9 / H.264)</p>
                  <p>• 停止錄影後將自動下載影片檔至電腦 Downloads 資料夾</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleStartRecording}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all shadow-md shadow-red-950 flex items-center space-x-1.5 active:scale-95"
                >
                  <Video className="w-4 h-4 fill-current" />
                  <span>選擇畫面並開始錄影</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Recording Control OSD (Visible when recording is active) */}
      {isRecording && (
        <div className="fixed top-16 right-5 z-50 bg-slate-950/95 border border-red-500/60 rounded-xl p-3 shadow-2xl backdrop-blur-md flex items-center space-x-3 animate-in fade-in slide-in-from-top-3 duration-200 select-none">
          {/* Status Indicator & Timer */}
          <div className="flex items-center space-x-2 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg">
            <span className={`w-3 h-3 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-xs font-semibold text-slate-200">
              {isPaused ? '錄影已暫停' : '教師錄影中'}
            </span>
            <span className="text-xs font-mono font-bold text-red-400 flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatTime(recordingTime)}</span>
            </span>
          </div>

          {/* Pause / Resume Button */}
          <button
            onClick={handlePauseResume}
            className={`p-2 rounded-lg border text-xs font-semibold transition-all active:scale-95 flex items-center space-x-1 ${
              isPaused
                ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/50'
                : 'bg-amber-600/30 border-amber-500/50 text-amber-300 hover:bg-amber-600/50'
            }`}
            title={isPaused ? '繼續錄影' : '暫停錄影'}
          >
            {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
          </button>

          {/* Stop & Save Button */}
          <button
            onClick={handleStopRecording}
            className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white border border-red-500 text-xs font-bold transition-all shadow-md active:scale-95 flex items-center space-x-1.5"
            title="停止錄影並下載儲存"
          >
            <Square className="w-4 h-4 fill-current" />
            <span>停止並存檔</span>
          </button>
        </div>
      )}

      {/* Save Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-950/95 border border-emerald-500/60 text-emerald-200 text-xs px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </>
  );
};
