import React, { useState, useEffect } from 'react';
import { StudentDevice } from '../../types';
import { X, Save, Trash2, Edit2, Monitor, Cpu, Wifi } from 'lucide-react';

interface EditSeatModalProps {
  isOpen: boolean;
  onClose: () => void;
  seat: StudentDevice | null;
  unassignedDevices: StudentDevice[];
  onSaveSeat: (updatedSeat: StudentDevice) => void;
  onUnbindSeat: (seatId: string) => void;
}

export const EditSeatModal: React.FC<EditSeatModalProps> = ({
  isOpen,
  onClose,
  seat,
  unassignedDevices,
  onSaveSeat,
  onUnbindSeat,
}) => {
  const [seatNo, setSeatNo] = useState('');
  const [hostname, setHostname] = useState('');
  const [username, setUsername] = useState('');
  const [mac, setMac] = useState('');
  const [ip, setIp] = useState('');

  useEffect(() => {
    if (seat) {
      setSeatNo(seat.seatNo || '');
      setHostname(seat.hostname || '');
      setUsername(seat.username || '');
      setMac(seat.mac || '');
      setIp(seat.ip || '');
    }
  }, [seat]);

  if (!isOpen || !seat) return null;

  const handleSelectFromPool = (devId: string) => {
    const found = unassignedDevices.find((d) => d.id === devId || d.mac === devId);
    if (found) {
      setMac(found.mac || '');
      setIp(found.ip || '');
      setHostname(found.hostname || hostname);
      if (found.username) setUsername(found.username);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: StudentDevice = {
      ...seat,
      seatNo: seatNo.trim() || seat.seatNo,
      hostname: hostname.trim() || seat.hostname,
      username: username.trim(),
      mac: mac.trim().toUpperCase(),
      ip: ip.trim() || seat.ip,
      // If bound MAC changed to an online device
      status: unassignedDevices.some((d) => d.mac && d.mac.toUpperCase() === mac.trim().toUpperCase())
        ? 'online'
        : seat.status,
    };
    onSaveSeat(updated);
    onClose();
  };

  const handleUnbind = () => {
    if (window.confirm(`確定要清空座位「${seat.seatNo}」的綁定資訊並將設備移回設備池嗎？`)) {
      onUnbindSeat(seat.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Edit2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>編輯座位資訊</span>
                <span className="px-2 py-0.5 rounded bg-sky-950 border border-sky-800/60 text-sky-400 text-xs font-mono">
                  {seat.seatNo}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                網格位置: 第 {seat.gridY} 列 (Y) · 第 {seat.gridX + 1} 欄 (X)
              </p>
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
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {/* Quick Select from Unassigned Device Pool */}
          {unassignedDevices.length > 0 && (
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1.5">
              <label className="block text-xs font-semibold text-sky-400 flex items-center space-x-1.5">
                <Wifi className="w-3.5 h-3.5" />
                <span>從在線待分配設備池快速指派：</span>
              </label>
              <select
                onChange={(e) => handleSelectFromPool(e.target.value)}
                defaultValue=""
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="" disabled>
                  -- 選擇在線設備 ({unassignedDevices.length} 台待分配) --
                </option>
                {unassignedDevices.map((d) => (
                  <option key={d.id} value={d.mac || d.id}>
                    {d.hostname} ({d.ip}) - MAC: {d.mac || '無'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Seat Number */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                座位編號 (Seat No)
              </label>
              <input
                type="text"
                value={seatNo}
                onChange={(e) => setSeatNo(e.target.value)}
                placeholder="例如: A1, B3, 01"
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Student Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                學生姓名 / 備註
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="例如: 王小明"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Hostname */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                主機名稱 (Hostname)
              </label>
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="例如: PC-01"
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* IP Address */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                IP 位址 (動態解析)
              </label>
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="例如: 192.168.1.101"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {/* Bound MAC Address */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>實體網卡 MAC 位址 (唯一硬體識別主鍵)</span>
              <span className="text-[10px] text-slate-500">DHCP 換 IP 不影響綁定</span>
            </label>
            <input
              type="text"
              value={mac}
              onChange={(e) => setMac(e.target.value.toUpperCase())}
              placeholder="例如: E0:D5:5E:66:22:B7"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-sky-400 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={handleUnbind}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-xs font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清空並移回設備池</span>
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-lg shadow-sky-600/30 transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                <span>儲存變更</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
