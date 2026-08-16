import { ClassroomLayout } from '../types';

const STORAGE_KEY = 'gridsight_layouts_v5';

export const LayoutStorage = {
  saveLayout(layout: ClassroomLayout) {
    const list = this.getAllLayouts();
    const idx = list.findIndex((l) => l.id === layout.id);
    if (idx >= 0) {
      list[idx] = layout;
    } else {
      list.push(layout);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  },

  getAllLayouts(): ClassroomLayout[] {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [this.getDefaultPreset('matrix')];
    try {
      return JSON.parse(data);
    } catch {
      return [this.getDefaultPreset('matrix')];
    }
  },

  exportLayoutJson(layout: ClassroomLayout): string {
    return JSON.stringify(layout, null, 2);
  },

  importLayoutJson(jsonStr: string): ClassroomLayout | null {
    try {
      return JSON.parse(jsonStr) as ClassroomLayout;
    } catch {
      return null;
    }
  },

  getDefaultPreset(type: 'matrix' | 'aisle' | 'island'): ClassroomLayout {
    if (type === 'aisle') {
      // Dual-zone center aisle (5x7 left + 5x7 right = 70 seats)
      const seats = [];
      let count = 1;
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          seats.push({
            id: `PC-${String(count).padStart(2, '0')}`,
            hostname: `PC-${String(count).padStart(2, '0')}`,
            ip: `192.168.1.${100 + count}`,
            mac: `00:1A:2B:3C:4D:${String(count).padStart(2, '0')}`,
            username: `Student${String(count).padStart(2, '0')}`,
            seatNo: `L${r + 1}-${c + 1}`,
            gridX: c,
            gridY: r + 1,
            status: 'online' as const,
            latencyMs: 12,
            lastSeen: Date.now(),
          });
          count++;
        }
        for (let c = 6; c < 11; c++) {
          seats.push({
            id: `PC-${String(count).padStart(2, '0')}`,
            hostname: `PC-${String(count).padStart(2, '0')}`,
            ip: `192.168.1.${100 + count}`,
            mac: `00:1A:2B:3C:4D:${String(count).padStart(2, '0')}`,
            username: `Student${String(count).padStart(2, '0')}`,
            seatNo: `R${r + 1}-${c - 5}`,
            gridX: c,
            gridY: r + 1,
            status: 'online' as const,
            latencyMs: 15,
            lastSeen: Date.now(),
          });
          count++;
        }
      }
      return {
        id: 'layout-aisle-70',
        name: '雙分區中走道 (左5×7 + 右5×7, 70台)',
        rows: 9,
        cols: 11,
        seats,
        aisles: [{ id: 'aisle-center', type: 'vertical', index: 5, label: '中央走道' }],
        obstacles: [
          { id: 'obs-podium', gridX: 4, gridY: 0, width: 3, height: 1, label: '教師講台 / 黑板', type: 'podium' }
        ]
      };
    }

    // Default: Standard Matrix 7x10
    const seats = [];
    let count = 1;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 10; c++) {
        seats.push({
          id: `PC-${String(count).padStart(2, '0')}`,
          hostname: `PC-${String(count).padStart(2, '0')}`,
          ip: `192.168.1.${100 + count}`,
          mac: `00:1A:2B:3C:4D:${String(count).padStart(2, '0')}`,
          username: `Student${String(count).padStart(2, '0')}`,
          seatNo: `${String.fromCharCode(65 + r)}${c + 1}`,
          gridX: c,
          gridY: r + 1,
          status: 'online' as const,
          latencyMs: 14,
          lastSeen: Date.now(),
        });
        count++;
      }
    }
    return {
      id: 'layout-matrix-70',
      name: '標準矩陣 (7×10, 70台)',
      rows: 9,
      cols: 10,
      seats,
      aisles: [],
      obstacles: [
        { id: 'obs-podium', gridX: 3, gridY: 0, width: 4, height: 1, label: '講台 / 黑板', type: 'podium' }
      ]
    };
  }
};
