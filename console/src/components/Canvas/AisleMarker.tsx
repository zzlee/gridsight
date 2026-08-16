import React from 'react';
import { GridAisle } from '../../types';

export const AisleMarker: React.FC<{ aisle: GridAisle }> = ({ aisle }) => {
  return (
    <div className="flex items-center justify-center bg-slate-950/40 border border-dashed border-slate-800/60 rounded-md select-none text-slate-500 text-xs font-medium">
      <div className="flex items-center space-x-2 tracking-widest uppercase">
        <span className="w-2 h-2 rounded-full bg-slate-700" />
        <span>{aisle.label || '走道'}</span>
        <span className="w-2 h-2 rounded-full bg-slate-700" />
      </div>
    </div>
  );
};
