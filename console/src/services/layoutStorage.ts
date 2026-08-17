import { ClassroomLayout, StudentDevice } from '../types';

const STORAGE_KEY = 'gridsight_layouts_v7';

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
    if (!data) return [this.createMatrixLayout(8, 6, '電腦教室 (8×6, 48台)')];
    try {
      return JSON.parse(data);
    } catch {
      return [this.createMatrixLayout(8, 6, '電腦教室 (8×6, 48台)')];
    }
  },

  exportLayoutJson(layout: ClassroomLayout): string {
    // Export with normalized MAC primary keys
    const sanitizedSeats = layout.seats.map((s) => ({
      id: s.id,
      mac: s.mac ? s.mac.toUpperCase() : '',
      hostname: s.hostname,
      seatNo: s.seatNo,
      gridX: s.gridX,
      gridY: s.gridY,
      lastKnownIp: s.ip,
    }));

    const exportObj = {
      ...layout,
      seats: sanitizedSeats,
      version: '5.4.0',
      exportedAt: new Date().toISOString(),
      bindingMode: 'MAC_PRIMARY_KEY',
    };

    return JSON.stringify(exportObj, null, 2);
  },

  importLayoutJson(jsonStr: string): ClassroomLayout | null {
    try {
      const parsed = JSON.parse(jsonStr) as ClassroomLayout;
      if (parsed && Array.isArray(parsed.seats)) {
        parsed.seats = parsed.seats.map((s: any) => ({
          ...s,
          ip: s.ip || s.lastKnownIp || '192.168.1.1',
          mac: s.mac ? s.mac.toUpperCase() : '',
          status: 'offline' as const,
          latencyMs: 0,
          lastSeen: 0,
        }));
      }
      return parsed;
    } catch {
      return null;
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
          gridY: r + 1, // Row 0 is reserved for podium/blackboard
          status: 'offline' as const,
          latencyMs: 0,
          lastSeen: 0,
        });
        count++;
      }
    }

    const podiumWidth = Math.min(cols, Math.max(2, Math.floor(cols * 0.4)));
    const podiumX = Math.max(0, Math.floor((cols - podiumWidth) / 2));

    return {
      id: `layout-matrix-${cols}x${rows}-${Date.now()}`,
      name: name || `標準矩陣 (${cols}×${rows}, ${cols * rows}台)`,
      rows: rows + 1, // +1 for teacher podium row
      cols: Math.max(cols, 4),
      seats,
      aisles: [],
      obstacles: [
        {
          id: 'obs-podium',
          gridX: podiumX,
          gridY: 0,
          width: podiumWidth,
          height: 1,
          label: '教師講台 / 黑板',
          type: 'podium',
        },
      ],
    };
  },
};
