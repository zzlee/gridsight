import React, { useState } from 'react';
import { ClassroomLayout, GridObstacle } from '../../types';
import { X, Save, Plus, Trash2, Edit2, ShieldAlert, Monitor, Landmark, DoorOpen, Presentation, Check } from 'lucide-react';

interface ObstacleModalProps {
  isOpen: boolean;
  onClose: () => void;
  layout: ClassroomLayout;
  onSaveObstacles: (obstacles: GridObstacle[]) => void;
}

export const ObstacleModal: React.FC<ObstacleModalProps> = ({
  isOpen,
  onClose,
  layout,
  onSaveObstacles,
}) => {
  const [obstacles, setObstacles] = useState<GridObstacle[]>(() => layout.obstacles || []);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State for creating/editing an obstacle
  const [type, setType] = useState<GridObstacle['type']>('podium');
  const [label, setLabel] = useState('教師講台');
  const [gridX, setGridX] = useState(0);
  const [gridY, setGridY] = useState(0);
  const [width, setWidth] = useState(2);
  const [height, setHeight] = useState(1);

  if (!isOpen) return null;

  const totalCols = layout.cols;
  const totalRows = layout.rows;

  const handleTypeSelect = (selectedType: GridObstacle['type']) => {
    setType(selectedType);
    if (!editingId) {
      switch (selectedType) {
        case 'podium':
          setLabel('教師講台');
          setWidth(2);
          setHeight(1);
          break;
        case 'blackboard':
          setLabel('主黑板 / 投影幕');
          setWidth(4);
          setHeight(1);
          break;
        case 'pillar':
          setLabel('結構柱');
          setWidth(1);
          setHeight(1);
          break;
        case 'door':
          setLabel('教室出入口');
          setWidth(1);
          setHeight(1);
          break;
      }
    }
  };

  const handleStartEdit = (obs: GridObstacle) => {
    setEditingId(obs.id);
    setType(obs.type);
    setLabel(obs.label);
    setGridX(obs.gridX);
    setGridY(obs.gridY);
    setWidth(obs.width);
    setHeight(obs.height);
  };

  const handleCancelForm = () => {
    setEditingId(null);
    setType('podium');
    setLabel('教師講台');
    setGridX(0);
    setGridY(0);
    setWidth(2);
    setHeight(1);
  };

  const handleAddOrUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      setObstacles((prev) =>
        prev.map((o) =>
          o.id === editingId
            ? { ...o, type, label: label.trim() || '障礙物', gridX, gridY, width, height }
            : o
        )
      );
      handleCancelForm();
    } else {
      const newObstacle: GridObstacle = {
        id: `obs-${Date.now()}`,
        type,
        label: label.trim() || '障礙物',
        gridX,
        gridY,
        width,
        height,
      };
      setObstacles((prev) => [...prev, newObstacle]);
      handleCancelForm();
    }
  };

  const handleDelete = (id: string) => {
    setObstacles((prev) => prev.filter((o) => o.id !== id));
    if (editingId === id) handleCancelForm();
  };

  const handleSave = () => {
    onSaveObstacles(obstacles);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <span>教室講台與障礙物管理 (Obstacles)</span>
                <span className="px-2 py-0.5 rounded bg-amber-950 border border-amber-800/60 text-amber-400 text-xs font-mono">
                  {obstacles.length} 個物件
                </span>
              </h2>
              <p className="text-xs text-slate-400">設定教師講台、黑板、結構柱與出入口，自動佔位並顯示於矩陣畫布</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Add / Edit Form */}
          <form onSubmit={handleAddOrUpdate} className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-sky-400 flex items-center space-x-1.5">
                {editingId ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                <span>{editingId ? '編輯現有物件' : '新增講台或結構障礙物'}</span>
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  取消編輯
                </button>
              )}
            </div>

            {/* Type selector */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { key: 'podium', label: '教師講台', icon: Presentation, color: 'text-sky-400 border-sky-500 bg-sky-950/50' },
                { key: 'blackboard', label: '黑板/螢幕', icon: Monitor, color: 'text-emerald-400 border-emerald-500 bg-emerald-950/50' },
                { key: 'pillar', label: '結構柱', icon: Landmark, color: 'text-amber-400 border-amber-500 bg-amber-950/50' },
                { key: 'door', label: '出入口', icon: DoorOpen, color: 'text-purple-400 border-purple-500 bg-purple-950/50' },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = type === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleTypeSelect(item.key as GridObstacle['type'])}
                    className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center justify-center space-y-1 transition-all ${
                      isSelected
                        ? `${item.color} ring-1 ring-offset-0 ring-current`
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Label */}
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">顯示名稱標籤</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="例如: 主講台, 投影布幕"
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Coordinates */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">網格 X 欄 (Column 0~{totalCols - 1})</label>
                <input
                  type="number"
                  min="0"
                  max={totalCols - 1}
                  value={gridX}
                  onChange={(e) => setGridX(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">網格 Y 列 (Row 0~{totalRows - 1})</label>
                <input
                  type="number"
                  min="0"
                  max={totalRows - 1}
                  value={gridY}
                  onChange={(e) => setGridY(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Spans */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">佔用寬度 (欄數)</label>
                <input
                  type="number"
                  min="1"
                  max={totalCols}
                  value={width}
                  onChange={(e) => setWidth(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">佔用高度 (列數)</label>
                <input
                  type="number"
                  min="1"
                  max={totalRows}
                  value={height}
                  onChange={(e) => setHeight(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 transition-all flex items-center space-x-1"
              >
                {editingId ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{editingId ? '更新物件' : '加入物件'}</span>
              </button>
            </div>
          </form>

          {/* List of existing obstacles */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">已配置的障礙物清單 ({obstacles.length})</label>
            {obstacles.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-slate-800">
                目前尚未建立任何講台或障礙物
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {obstacles.map((obs) => {
                  const rowLabel = String.fromCharCode(65 + (obs.gridY % 26));
                  return (
                    <div
                      key={obs.id}
                      className="p-3 bg-slate-950/90 border border-slate-800 rounded-xl flex items-center justify-between hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-slate-800 text-amber-400">
                          {obs.type === 'podium' && <Presentation className="w-4 h-4" />}
                          {obs.type === 'blackboard' && <Monitor className="w-4 h-4 text-emerald-400" />}
                          {obs.type === 'pillar' && <Landmark className="w-4 h-4 text-amber-400" />}
                          {obs.type === 'door' && <DoorOpen className="w-4 h-4 text-purple-400" />}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200 text-xs">{obs.label}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            坐標: ({rowLabel}, {obs.gridX + 1}) · 尺寸: {obs.width}×{obs.height} 網格
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(obs)}
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                          title="編輯"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(obs.id)}
                          className="p-1.5 rounded bg-rose-950/50 hover:bg-rose-600 text-rose-400 hover:text-white transition-colors"
                          title="刪除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 shadow-lg shadow-sky-600/30 transition-all flex items-center space-x-1.5"
          >
            <Save className="w-4 h-4" />
            <span>儲存障礙物配置</span>
          </button>
        </div>
      </div>
    </div>
  );
};
