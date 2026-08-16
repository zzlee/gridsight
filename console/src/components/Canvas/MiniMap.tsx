import React from 'react';
import { ClassroomLayout } from '../../types';

interface MiniMapProps {
  layout: ClassroomLayout;
}

export const MiniMap: React.FC<MiniMapProps> = ({ layout }) => {
  return (
    <div className="absolute bottom-4 right-4 w-48 h-32 bg-slate-950/90 border border-slate-800 rounded-lg p-2 shadow-2xl backdrop-blur flex flex-col z-20 pointer-events-none">
      <div className="text-[10px] text-slate-400 font-medium mb-1 flex justify-between">
        <span>全景導航 (Mini-map)</span>
        <span>{layout.seats.length} 台</span>
      </div>
      <div className="relative flex-1 bg-slate-900 rounded border border-slate-800/50 grid gap-0.5 p-1"
           style={{
             gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
             gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
           }}>
        {layout.seats.map((seat) => (
          <div
            key={seat.id}
            className={`rounded-[1px] ${
              seat.status === 'online' ? 'bg-emerald-500/80' : seat.status === 'degraded' ? 'bg-amber-500/80' : 'bg-rose-500/60'
            }`}
            style={{
              gridColumnStart: seat.gridX + 1,
              gridRowStart: seat.gridY + 1,
            }}
          />
        ))}
      </div>
    </div>
  );
};
