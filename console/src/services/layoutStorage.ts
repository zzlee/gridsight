import { ClassroomLayout, StudentDevice } from '../types';
import { AuthService } from './authService';

const STORAGE_KEY = 'gridsight_layouts_v10';

export const DEFAULT_OFFTASK_KEYWORDS = [
  'YouTube', 'Bilibili', 'Roblox', 'Minecraft', 'Steam',
  'Discord', 'Twitch', '抖音', 'Tiktok', '巴哈姆特',
  '動畫瘋', 'Facebook', 'Instagram', 'Netflix', 'Game', '遊戲'
];

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
          // Filter out any legacy dummy placeholder seats
          data.layout.seats = data.layout.seats.filter(
            (s: any) =>
              !(
                s.status === 'offline' &&
                s.ip?.startsWith('192.168.1.') &&
                s.mac?.startsWith('00:1A:2B:3C')
              )
          );
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
    if (!data) return this.createMatrixLayout(8, 6, '電腦教室 (8×6, 48席位)');
    try {
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.seats)) {
        parsed.seats = parsed.seats.filter(
          (s: any) =>
            !(
              s.status === 'offline' &&
              s.ip?.startsWith('192.168.1.') &&
              s.mac?.startsWith('00:1A:2B:3C')
            )
        );
        return parsed;
      }
      return this.createMatrixLayout(8, 6, '電腦教室 (8×6, 48席位)');
    } catch {
      return this.createMatrixLayout(8, 6, '電腦教室 (8×6, 48席位)');
    }
  },

  /**
   * Generates a customizable X * Y standard matrix layout (No person limit).
   * All unassigned seats are empty by default.
   * @param cols Number of horizontal columns (X)
   * @param rows Number of vertical rows (Y)
   * @param name Classroom layout name
   */
  createMatrixLayout(cols: number, rows: number, name?: string): ClassroomLayout {
    return {
      id: `layout-matrix-${cols}x${rows}-${Date.now()}`,
      name: name || `電腦教室 (${cols}×${rows}, ${cols * rows}席位)`,
      rows,
      cols: Math.max(cols, 4),
      seats: [], // Clean blank seats by default!
      aisles: [],
      obstacles: [],
      offTaskKeywords: DEFAULT_OFFTASK_KEYWORDS,
    };
  },
};
