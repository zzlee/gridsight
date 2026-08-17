import React, { useEffect, useState, useRef } from 'react';
import { ClassroomLayout, StudentDevice, AppMode } from './types';
import { TopNav } from './components/Toolbar/TopNav';
import { GridCanvas } from './components/Canvas/GridCanvas';
import { FocusModal } from './components/Viewer/FocusModal';
import { DeviceSpecsModal } from './components/Viewer/DeviceSpecsModal';
import { MatrixConfigModal } from './components/Toolbar/MatrixConfigModal';
import { DevicePool } from './components/Toolbar/DevicePool';
import { AuthLockModal } from './components/Auth/AuthLockModal';
import { ChangePinModal } from './components/Auth/ChangePinModal';
import { PollingManager, TrafficStats } from './services/pollingManager';
import { LayoutStorage } from './services/layoutStorage';
import { AuthService } from './services/authService';

const pollingManager = new PollingManager();

export const App: React.FC = () => {
  const visibleDeviceIdsRef = useRef<Set<string>>(new Set());
  const [trafficStats, setTrafficStats] = useState<TrafficStats | null>(null);
  const [isLocked, setIsLocked] = useState(true);
  const [isChangePinOpen, setIsChangePinOpen] = useState(false);
  const [mode, setMode] = useState<AppMode>('MONITOR');
  const [layout, setLayout] = useState<ClassroomLayout>(() => {
    const saved = LayoutStorage.getAllLayouts();
    return saved.length > 0 ? saved[0] : LayoutStorage.createMatrixLayout(8, 6, '電腦教室 (8×6, 48台)');
  });
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const [focusDevice, setFocusDevice] = useState<StudentDevice | null>(null);
  const [specsDevice, setSpecsDevice] = useState<StudentDevice | null>(null);
  const [isMatrixConfigOpen, setIsMatrixConfigOpen] = useState(false);
  const [isDevicePoolOpen, setIsDevicePoolOpen] = useState(false);
  const [zoom, setZoom] = useState(0.85);

  const [unassignedDevices, setUnassignedDevices] = useState<StudentDevice[]>([]);

  // Check auth session on startup
  useEffect(() => {
    AuthService.verify().then((authed) => {
      setIsLocked(!authed);
    });
  }, []);

  // Fetch discovered devices from backend /api/agents (relative path with auth)
  useEffect(() => {
    if (isLocked) return;

    const fetchAgents = async () => {
      try {
        const resp = await AuthService.fetchWithAuth('/api/agents');
        if (resp.ok) {
          const data = await resp.json();
          if (data.agents && Array.isArray(data.agents)) {
            const discovered: StudentDevice[] = data.agents.map((a: any) => ({
              id: a.mac || `dev-${a.ip.replace(/\./g, '-')}`,
              hostname: a.hostname,
              ip: a.ip,
              mac: a.mac,
              status: 'online',
              token: a.token,
              specs: a.specs,
              gridX: 0,
              gridY: 0,
            }));

            // Match discovered agents to layout seats
            setLayout((prev) => {
              const assignedIps = new Set<string>();
              const updatedSeats = [...prev.seats];

              // 1. First pass: Match exact IP or MAC
              discovered.forEach((dev) => {
                const idx = updatedSeats.findIndex((s) => s.ip === dev.ip || (s.mac && s.mac === dev.mac));
                if (idx !== -1) {
                  assignedIps.add(dev.ip);
                  updatedSeats[idx] = {
                    ...updatedSeats[idx],
                    hostname: dev.hostname || updatedSeats[idx].hostname,
                    token: dev.token || updatedSeats[idx].token,
                    mac: dev.mac || updatedSeats[idx].mac,
                    specs: dev.specs || updatedSeats[idx].specs,
                    status: 'online',
                  };
                }
              });

              // 2. Second pass: Auto-bind any remaining online discovered devices to dummy/offline default seats (192.168.1.x)
              const unassigned = discovered.filter((d) => !assignedIps.has(d.ip));
              unassigned.forEach((dev) => {
                const dummyIdx = updatedSeats.findIndex(
                  (s) => (s.ip.startsWith('192.168.1.') || s.status === 'offline') && !assignedIps.has(s.ip)
                );
                if (dummyIdx !== -1) {
                  assignedIps.add(dev.ip);
                  updatedSeats[dummyIdx] = {
                    ...updatedSeats[dummyIdx],
                    id: dev.id,
                    hostname: dev.hostname,
                    ip: dev.ip,
                    mac: dev.mac,
                    token: dev.token,
                    specs: dev.specs,
                    status: 'online',
                  };
                }
              });

              const remainingUnassigned = discovered.filter((d) => !assignedIps.has(d.ip));
              setUnassignedDevices(remainingUnassigned);

              return { ...prev, seats: updatedSeats };
            });
          }
        }
      } catch {
        // Backend not running, default layout remains active
      }
    };

    fetchAgents();
    const timer = setInterval(fetchAgents, 3000);
    return () => clearInterval(timer);
  }, [isLocked]);

  // 1 FPS Snapshot Polling & Periodic /status Telemetry with Viewport Culling & Circuit Breaker
  useEffect(() => {
    if (mode === 'MONITOR' && !isLocked) {
      pollingManager.startPolling(
        () => layoutRef.current.seats,
        (updated) => {
          setLayout((prev) => ({
            ...prev,
            seats: prev.seats.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
          }));

          // Keep active modal device state up-to-date
          setFocusDevice((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
          setSpecsDevice((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
        },
        1000,
        () => visibleDeviceIdsRef.current,
        (stats) => setTrafficStats(stats)
      );
    } else {
      pollingManager.stopPolling();
      setTrafficStats(null);
    }

    return () => {
      pollingManager.stopPolling();
      setTrafficStats(null);
    };
  }, [mode, isLocked]);

  const handleSelectStudent = (id: string, multi: boolean) => {
    setLayout((prev) => ({
      ...prev,
      seats: prev.seats.map((s) => {
        if (s.id === id) {
          return { ...s, selected: !s.selected };
        }
        return multi ? s : { ...s, selected: false };
      }),
    }));
  };

  const handleRefreshAuth = (device: StudentDevice) => {
    // Generate and inject new dynamic RAM token
    const newToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    setLayout((prev) => ({
      ...prev,
      seats: prev.seats.map((s) => (s.id === device.id ? { ...s, token: newToken } : s)),
    }));
  };

  const handleUnbindSeat = (id: string) => {
    handleReturnToPool(id);
  };

  // Drag & Drop: Swap two seats on the grid
  const handleSwapSeats = (idA: string, idB: string) => {
    setLayout((prev) => {
      const idxA = prev.seats.findIndex((s) => s.id === idA);
      const idxB = prev.seats.findIndex((s) => s.id === idB);
      if (idxA === -1 || idxB === -1) return prev;

      const updated = [...prev.seats];
      const seatA = updated[idxA];
      const seatB = updated[idxB];

      const tempX = seatA.gridX;
      const tempY = seatA.gridY;
      const tempSeatNo = seatA.seatNo;

      updated[idxA] = { ...seatA, gridX: seatB.gridX, gridY: seatB.gridY, seatNo: seatB.seatNo };
      updated[idxB] = { ...seatB, gridX: tempX, gridY: tempY, seatNo: tempSeatNo };

      const newLayout = { ...prev, seats: updated };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Drag & Drop: Move a seat to an empty grid cell [x, y]
  const handleMoveSeat = (id: string, newGridX: number, newGridY: number) => {
    setLayout((prev) => {
      const updated = prev.seats.map((s) => (s.id === id ? { ...s, gridX: newGridX, gridY: newGridY } : s));
      const newLayout = { ...prev, seats: updated };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Drag & Drop: Return a student card from canvas back to Device Pool
  const handleReturnToPool = (seatId: string) => {
    setLayout((prev) => {
      const seat = prev.seats.find((s) => s.id === seatId);
      if (!seat) return prev;

      // Add to unassigned devices if it is a real online machine or discovered device
      if (seat.status === 'online' || seat.mac || !seat.id.startsWith('PC-Slot-')) {
        setUnassignedDevices((pool) => {
          if (pool.some((d) => d.id === seat.id || (d.mac && d.mac === seat.mac) || d.ip === seat.ip)) {
            return pool;
          }
          return [...pool, seat];
        });
      }

      // Remove from active layout seats
      const updatedSeats = prev.seats.filter((s) => s.id !== seatId);
      const newLayout = { ...prev, seats: updatedSeats };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Drag & Drop: Drag an unassigned machine from Device Pool into canvas grid [x, y]
  const handleAssignFromPool = (deviceId: string, targetGridX: number, targetGridY: number) => {
    const dev = unassignedDevices.find((d) => d.id === deviceId);
    if (!dev) return;

    // Remove from unassigned pool
    setUnassignedDevices((prev) => prev.filter((d) => d.id !== deviceId));

    setLayout((prev) => {
      const rowLabel = String.fromCharCode(65 + ((targetGridY - 1) % 26));
      const seatNo = `${rowLabel}${targetGridX + 1}`;

      // If a seat already exists at target coordinate, return that old seat to pool
      const existingSeat = prev.seats.find((s) => s.gridX === targetGridX && s.gridY === targetGridY);
      if (existingSeat && (existingSeat.status === 'online' || existingSeat.mac)) {
        setUnassignedDevices((pool) => [...pool, existingSeat]);
      }

      const otherSeats = prev.seats.filter(
        (s) => !(s.gridX === targetGridX && s.gridY === targetGridY) && s.id !== dev.id
      );

      const newSeat: StudentDevice = {
        ...dev,
        gridX: targetGridX,
        gridY: targetGridY,
        seatNo: dev.seatNo || seatNo,
        status: 'online',
      };

      const newLayout = {
        ...prev,
        seats: [...otherSeats, newSeat],
      };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Auto assign all unassigned pool devices sequentially into empty seats
  const handleAutoAssign = () => {
    setLayout((prev) => {
      const occupiedCoords = new Set(prev.seats.map((s) => `${s.gridX},${s.gridY}`));
      const newSeats = [...prev.seats];
      const remainingPool: StudentDevice[] = [];

      unassignedDevices.forEach((dev) => {
        let assigned = false;
        for (let r = 1; r < prev.rows; r++) {
          for (let c = 0; c < prev.cols; c++) {
            const key = `${c},${r}`;
            if (!occupiedCoords.has(key)) {
              occupiedCoords.add(key);
              const rowLabel = String.fromCharCode(65 + ((r - 1) % 26));
              newSeats.push({
                ...dev,
                gridX: c,
                gridY: r,
                seatNo: `${rowLabel}${c + 1}`,
                status: 'online',
              });
              assigned = true;
              break;
            }
          }
          if (assigned) break;
        }

        if (!assigned) {
          remainingPool.push(dev);
        }
      });

      setUnassignedDevices(remainingPool);
      const newLayout = { ...prev, seats: newSeats };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  const handleAssignToFirstAvailable = (device: StudentDevice) => {
    setLayout((prev) => {
      const occupiedCoords = new Set(prev.seats.map((s) => `${s.gridX},${s.gridY}`));
      let targetX = 0;
      let targetY = 1;
      let found = false;

      for (let r = 1; r < prev.rows; r++) {
        for (let c = 0; c < prev.cols; c++) {
          if (!occupiedCoords.has(`${c},${r}`)) {
            targetX = c;
            targetY = r;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        targetX = 0;
        targetY = prev.rows;
      }

      setUnassignedDevices((pool) => pool.filter((d) => d.id !== device.id));

      const rowLabel = String.fromCharCode(65 + ((targetY - 1) % 26));
      const newSeat: StudentDevice = {
        ...device,
        gridX: targetX,
        gridY: targetY,
        seatNo: `${rowLabel}${targetX + 1}`,
        status: 'online',
      };

      const newLayout = {
        ...prev,
        rows: Math.max(prev.rows, targetY + 1),
        seats: [...prev.seats, newSeat],
      };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Apply customizable X * Y Matrix Dimensions
  const handleApplyMatrix = (cols: number, rows: number, name: string, keepExisting: boolean) => {
    if (!keepExisting) {
      // Move all current online devices into unassigned pool
      const onlineAssigned = layout.seats.filter((s) => s.status === 'online');
      setUnassignedDevices((prev) => {
        const poolIps = new Set(prev.map((d) => d.ip));
        const added = onlineAssigned.filter((d) => !poolIps.has(d.ip));
        return [...prev, ...added];
      });

      const newLayout = LayoutStorage.createMatrixLayout(cols, rows, name);
      setLayout(newLayout);
      LayoutStorage.saveLayout(newLayout);
    } else {
      const withinBounds: StudentDevice[] = [];
      const outOfBounds: StudentDevice[] = [];

      layout.seats.forEach((seat) => {
        if (seat.gridX < cols && seat.gridY <= rows) {
          withinBounds.push(seat);
        } else {
          if (seat.status === 'online' || seat.mac) {
            outOfBounds.push(seat);
          }
        }
      });

      if (outOfBounds.length > 0) {
        setUnassignedDevices((prev) => {
          const poolIps = new Set(prev.map((d) => d.ip));
          const added = outOfBounds.filter((d) => !poolIps.has(d.ip));
          return [...prev, ...added];
        });
      }

      // Fill in empty coordinates with clean empty seat slots
      const existingCoordSet = new Set(withinBounds.map((s) => `${s.gridX},${s.gridY}`));
      let count = withinBounds.length + 1;
      for (let r = 0; r < rows; r++) {
        const rowLabel = String.fromCharCode(65 + (r % 26));
        for (let c = 0; c < cols; c++) {
          const key = `${c},${r + 1}`;
          if (!existingCoordSet.has(key)) {
            withinBounds.push({
              id: `PC-Slot-${c}-${r + 1}`,
              hostname: `PC-${String(count).padStart(2, '0')}`,
              ip: `192.168.1.${100 + count}`,
              mac: `00:1A:2B:3C:4D:${String(count).padStart(2, '0')}`,
              username: `Student${String(count).padStart(2, '0')}`,
              seatNo: `${rowLabel}${c + 1}`,
              gridX: c,
              gridY: r + 1,
              status: 'offline',
              latencyMs: 0,
              lastSeen: 0,
            });
            count++;
          }
        }
      }

      const podiumWidth = Math.min(cols, Math.max(2, Math.floor(cols * 0.4)));
      const podiumX = Math.max(0, Math.floor((cols - podiumWidth) / 2));

      const newLayout: ClassroomLayout = {
        id: `layout-matrix-${cols}x${rows}-${Date.now()}`,
        name: name || `標準矩陣 (${cols}×${rows}, ${cols * rows}台)`,
        cols: Math.max(cols, 4),
        rows: rows + 1,
        seats: withinBounds,
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

      setLayout(newLayout);
      LayoutStorage.saveLayout(newLayout);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 overflow-hidden">
      <TopNav
        mode={mode}
        setMode={setMode}
        layout={layout}
        onLayoutChange={setLayout}
        onOpenMatrixConfig={() => setIsMatrixConfigOpen(true)}
        onOpenDevicePool={() => setIsDevicePoolOpen(true)}
        unassignedCount={unassignedDevices.length}
        zoom={zoom}
        setZoom={setZoom}
        onResetView={() => setZoom(0.85)}
        onLock={() => setIsLocked(true)}
        onOpenChangePin={() => setIsChangePinOpen(true)}
        trafficStats={trafficStats}
      />

      <GridCanvas
        layout={layout}
        mode={mode}
        zoom={zoom}
        onSelectStudent={handleSelectStudent}
        onFocusStudent={setFocusDevice}
        onRefreshAuth={handleRefreshAuth}
        onUnbindSeat={handleUnbindSeat}
        onOpenSpecs={setSpecsDevice}
        onVisibleSeatsChange={(ids) => {
          visibleDeviceIdsRef.current = ids;
        }}
        onSwapSeats={handleSwapSeats}
        onMoveSeat={handleMoveSeat}
        onAssignFromPool={handleAssignFromPool}
      />

      {/* Focus 30FPS WebCodecs Viewer Modal */}
      <FocusModal
        device={focusDevice}
        onClose={() => setFocusDevice(null)}
      />

      {/* Hardware Specs & Telemetry Modal */}
      <DeviceSpecsModal
        device={specsDevice}
        onClose={() => setSpecsDevice(null)}
      />

      {/* X * Y Standard Matrix Customizer Modal */}
      <MatrixConfigModal
        isOpen={isMatrixConfigOpen}
        onClose={() => setIsMatrixConfigOpen(false)}
        currentLayout={layout}
        onApplyMatrix={handleApplyMatrix}
      />

      {/* Device Pool Drawer (Two-Way Drag-and-Drop) */}
      <DevicePool
        isOpen={isDevicePoolOpen}
        onClose={() => setIsDevicePoolOpen(false)}
        unassignedDevices={unassignedDevices}
        onAutoAssign={handleAutoAssign}
        onReturnToPool={handleReturnToPool}
        onAssignToFirstAvailable={handleAssignToFirstAvailable}
      />

      {/* Change Teacher PIN Modal */}
      <ChangePinModal
        isOpen={isChangePinOpen}
        onClose={() => setIsChangePinOpen(false)}
      />

      {/* Security Auth Lock Modal (PIN Entry) */}
      {isLocked && (
        <AuthLockModal onUnlock={() => setIsLocked(false)} />
      )}
    </div>
  );
};
