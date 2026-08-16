import React from 'react';
import { GridObstacle } from '../../types';

export const ObstacleMarker: React.FC<{ obstacle: GridObstacle }> = ({ obstacle }) => {
  return (
    <div className="flex items-center justify-center rounded-lg bg-sky-950/30 border border-sky-800/40 text-sky-400 font-semibold text-sm shadow-inner shadow-sky-950/50">
      <div className="flex items-center space-x-2 px-4 py-2 bg-slate-900/80 rounded border border-slate-800">
        <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-pulse" />
        <span>{obstacle.label}</span>
      </div>
    </div>
  );
};
