import React from 'react';
import { GridObstacle } from '../../types';
import { Presentation, Monitor, Landmark, DoorOpen, Edit2, Trash2 } from 'lucide-react';

interface ObstacleMarkerProps {
  obstacle: GridObstacle;
  isEditMode?: boolean;
  onEdit?: (obstacle: GridObstacle) => void;
  onDelete?: (id: string) => void;
}

const ObstacleMarkerComponent: React.FC<ObstacleMarkerProps> = ({
  obstacle,
  isEditMode = false,
  onEdit,
  onDelete,
}) => {
  const getStyleAndIcon = () => {
    switch (obstacle.type) {
      case 'podium':
        return {
          bg: 'bg-gradient-to-br from-sky-950/80 via-slate-900/90 to-sky-900/40 border-sky-500/60 text-sky-300 ring-1 ring-sky-500/30',
          icon: <Presentation className="w-5 h-5 text-sky-400" />,
          badgeBg: 'bg-sky-950/90 border-sky-800/80 text-sky-300',
          dot: 'bg-sky-400 animate-pulse',
        };
      case 'blackboard':
        return {
          bg: 'bg-gradient-to-br from-emerald-950/80 via-slate-900/90 to-emerald-900/30 border-emerald-500/50 text-emerald-300 ring-1 ring-emerald-500/20',
          icon: <Monitor className="w-5 h-5 text-emerald-400" />,
          badgeBg: 'bg-emerald-950/90 border-emerald-800/80 text-emerald-300',
          dot: 'bg-emerald-400',
        };
      case 'pillar':
        return {
          bg: 'bg-slate-900/90 border-slate-700/80 text-slate-300 ring-1 ring-slate-600/30',
          icon: <Landmark className="w-5 h-5 text-amber-400" />,
          badgeBg: 'bg-slate-950/90 border-slate-800 text-slate-300',
          dot: 'bg-amber-400',
        };
      case 'door':
        return {
          bg: 'bg-gradient-to-br from-purple-950/70 via-slate-900/90 to-purple-900/30 border-purple-500/50 text-purple-300 ring-1 ring-purple-500/20',
          icon: <DoorOpen className="w-5 h-5 text-purple-400" />,
          badgeBg: 'bg-purple-950/90 border-purple-800/80 text-purple-300',
          dot: 'bg-purple-400',
        };
      default:
        return {
          bg: 'bg-slate-900 border-slate-800 text-slate-400',
          icon: <Landmark className="w-5 h-5 text-slate-400" />,
          badgeBg: 'bg-slate-950 border-slate-800 text-slate-400',
          dot: 'bg-slate-400',
        };
    }
  };

  const theme = getStyleAndIcon();

  return (
    <div
      className={`w-full h-full rounded-xl border flex flex-col items-center justify-center p-3 shadow-xl backdrop-blur-sm relative group overflow-hidden select-none transition-all ${theme.bg}`}
    >
      {/* Background hatched pattern for architectural depth */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, #38bdf8 0, #38bdf8 1px, transparent 0, transparent 16px)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center space-y-1.5 text-center">
        <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60 shadow-inner">
          {theme.icon}
        </div>
        <div className={`px-3 py-1 rounded-lg border text-xs font-bold font-mono tracking-wide flex items-center space-x-1.5 shadow ${theme.badgeBg}`}>
          <span className={`w-2 h-2 rounded-full ${theme.dot}`} />
          <span>{obstacle.label}</span>
        </div>
      </div>

      {/* Edit mode quick action buttons */}
      {isEditMode && (
        <div className="absolute top-2 right-2 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(obstacle);
              }}
              className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-sky-600 text-slate-300 hover:text-white border border-slate-700 shadow-md transition-colors"
              title="編輯此物件"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(obstacle.id);
              }}
              className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-rose-600 text-rose-400 hover:text-white border border-slate-700 shadow-md transition-colors"
              title="刪除此物件"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const ObstacleMarker = React.memo(ObstacleMarkerComponent, (prev, next) => {
  return (
    prev.isEditMode === next.isEditMode &&
    prev.obstacle.id === next.obstacle.id &&
    prev.obstacle.type === next.obstacle.type &&
    prev.obstacle.label === next.obstacle.label &&
    prev.obstacle.gridX === next.obstacle.gridX &&
    prev.obstacle.gridY === next.obstacle.gridY &&
    prev.obstacle.width === next.obstacle.width &&
    prev.obstacle.height === next.obstacle.height
  );
});
