import { ClassroomLayout, StudentDevice } from '../types';
import { AuthService } from './authService';

const STORAGE_KEY = 'gridsight_layouts_v9';

export const LayoutStorage = {
  /**
   * Save layout to backend server (which writes to SEATS_FILE specified in .env)
   */
  async saveLayout(layout: ClassroomLayout): Promise<boolean> {
    // 1. Cache to localStorage for instant offline recovery
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // ignore
    }

    // 2. Persist directly to backend server SEATS_FILE
    try {
      const resp = await AuthService.fetchWithAuth('/api/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layout),
      });
      return resp.ok;
    } catch (err) {
      console.warn('[LayoutStorage] Failed to persist to backend /api/layout:', err);
      return false;
    }
  },

  /**
   * Fetch layout from backend server SEATS_FILE
   */
  async fetchServerLayout(): Promise<ClassroomLayout | null> {
    try {
      const resp = await AuthService.fetchWithAuth('/api/layout');
      if (resp.ok) {
        const data = await resp.json();
        if (data.layout && Array.isArray(data.layout.seats)) {
          // Normalize: if seats start at gridY=1, shift to start at gridY=0
          const minGridY = Math.min(...data.layout.seats.map((s: any) => s.gridY));
          if (minGridY === 1) {
            data.layout.seats = data.layout.seats.map((s: any) => ({
              ...s,
              gridY: s.gridY - 1,
            }));
            data.layout.rows = Math.max(...data.layout.seats.map((s: any) => s.gridY)) + 1;
            data.layout.obstacles = [];
            this.saveLayout(data.layout);
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.layout));
          return data.layout;
        }
      }
    } catch (err) {
      console.warn('[LayoutStorage] Failed to fetch layout from server:', err);
    }
    return this.getLocalCachedLayout();
  },

  getLocalCachedLayout(): ClassroomLayout {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return this.createMatrixLayout(8, 6, '電腦教室 (8×6, 48台)');
    try {
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.seats)) {
        const minGridY = Math.min(...parsed.seats.map((s: any) => s.gridY));
        if (minGridY === 1) {
          parsed.seats = parsed.seats.map((s: any) => ({ ...s, gridY: s.gridY - 1 }));
          parsed.rows = Math.max(...parsed.seats.map((s: any) => s.gridY)) + 1;
          parsed.obstacles = [];
        }
        return parsed;
      }
      return this.createMatrixLayout(8, 6, '電腦教室 (8×6, 48台)');
    } catch {
      return this.createMatrixLayout(8, 6, '電腦教室 (8×6, 48台)');
    }
  },

  /**
   * Generates a customizable X * Y standard matrix layout (No person limit).
   * @param cols Number of horizontal columns (X)
   * @param rows Number of vertical rows (Y)
   * @param name Classroom layout name
   */
  createMatrixLayout(cols: number, rows: number, name?: string): ClassroomLayout {
    const seats: StudentDevice[] = [];
    let count = 1;

    for (let r = 0; r < rows; r++) {
      const rowLabel = String.fromCharCode(65 + (r % 26)) + (r >= 26 ? Math.floor(r / 26) : '');
      for (let c = 0; c < cols; c++) {
        const seatNo = `${rowLabel}${c + 1}`;
        seats.push({
          id: `PC-${String(count).padStart(2, '0')}`,
          hostname: `PC-${String(count).padStart(2, '0')}`,
          ip: `192.168.1.${100 + count}`,
          mac: `00:1A:2B:3C:4D:${String(count).padStart(2, '0')}`,
          username: `Student${String(count).padStart(2, '0')}`,
          seatNo,
          gridX: c,
          gridY: r, // Row A starts directly at Y=0 (no blank top margin)
          status: 'offline' as const,
          latencyMs: 0,
          lastSeen: 0,
        });
        count++;
      }
    }

    return {
      id: `layout-matrix-${cols}x${rows}-${Date.now()}`,
      name: name || `標準矩陣 (${cols}×${rows}, ${cols * rows}台)`,
      rows,
      cols: Math.max(cols, 4),
      seats,
      aisles: [],
      obstacles: [],
    };
  },
};
