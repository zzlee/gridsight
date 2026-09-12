#!/bin/bash
cat << 'INNER_EOF' > /tmp/update_modal.py
import re

with open('console/src/components/Toolbar/TeacherRecordModal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

presets = """
type RecordQuality = 'high' | 'medium' | 'low';
const QUALITY_PRESETS: Record<RecordQuality, { label: string; desc: string }> = {
  high:   { label: '高',   desc: '1080p · 30FPS · 8Mbps' },
  medium: { label: '中',   desc: '720p · 30FPS · 4Mbps' },
  low:    { label: '低',   desc: '480p · 15FPS · 1.5Mbps' },
};
"""

content = re.sub(r'(interface ServerRecordStatus \{)', presets + r'\n\1', content)

state_vars = """
  const [recordQuality, setRecordQuality] = useState<RecordQuality>(() => {
    return (localStorage.getItem('gridsight_record_quality') as RecordQuality) || 'high';
  });
"""

content = re.sub(r'(const \[audioLoading, setAudioLoading\] = useState\(false\);)', r'\1\n' + state_vars, content)

content = re.sub(r'quality: \'high\'', 'quality: recordQuality', content)

ui_block = """
                      {/* Quality Selection */}
                      <div className="text-left p-3.5 bg-slate-900 border border-slate-700/80 rounded-lg space-y-2 max-w-md mx-auto mt-3">
                        <label className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                          <Video className="w-3.5 h-3.5 text-purple-400" />
                          <span>錄影畫質選項</span>
                        </label>
                        {isBroadcasting ? (
                          <div className="text-[11px] text-slate-400 bg-slate-950 px-2.5 py-2 rounded-lg border border-slate-800">
                            💡 目前正在全體廣播，為節省系統資源，錄影將直接錄製廣播內容，不另外編碼。
                          </div>
                        ) : (
                          <select
                            value={recordQuality}
                            onChange={(e) => {
                              setRecordQuality(e.target.value as RecordQuality);
                              localStorage.setItem('gridsight_record_quality', e.target.value);
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500 cursor-pointer"
                          >
                            {(Object.keys(QUALITY_PRESETS) as RecordQuality[]).map((key) => (
                              <option key={key} value={key}>
                                {QUALITY_PRESETS[key].label} ({QUALITY_PRESETS[key].desc})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
"""

content = content.replace('</div>\n\n                      <button\n                        onClick={handleStartRecording}', '</div>\n' + ui_block + '\n                      <button\n                        onClick={handleStartRecording}')

with open('console/src/components/Toolbar/TeacherRecordModal.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
INNER_EOF
python3 /tmp/update_modal.py
