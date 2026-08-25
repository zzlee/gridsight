import { useState, useEffect } from 'react';

export function useViewport() {
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('gridsight_zoom');
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.3 && val <= 2.5) return val;
      }
    } catch {}
    return 1;
  });

  const [pan, setPan] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem('gridsight_pan');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
      }
    } catch {}
    return { x: 0, y: 0 };
  });

  // Persist zoom to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('gridsight_viewport_zoom', zoom.toString());
    } catch {}
  }, [zoom]);

  // Persist pan to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('gridsight_viewport_pan', JSON.stringify(pan));
    } catch {}
  }, [pan]);

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    try {
      localStorage.setItem('gridsight_zoom', '1');
      localStorage.setItem('gridsight_pan', JSON.stringify({ x: 0, y: 0 }));
    } catch {}
  };

  return {
    zoom,
    setZoom,
    pan,
    setPan,
    handleResetView,
  };
}
