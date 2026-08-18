import React, { useEffect, useState, useRef } from 'react';
import { ClassroomLayout, StudentDevice, AppMode } from './types';
import { TopNav } from './components/Toolbar/TopNav';
import { GridCanvas } from './components/Canvas/GridCanvas';
import { FocusModal } from './components/Viewer/FocusModal';
import { DeviceSpecsModal } from './components/Viewer/DeviceSpecsModal';
import { MatrixConfigModal } from './components/Toolbar/MatrixConfigModal';
import { EditSeatModal } from './components/Toolbar/EditSeatModal';
import { BatchActionToolbar } from './components/Toolbar/BatchActionToolbar';
import { BatchEditModal } from './components/Toolbar/BatchEditModal';
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
  const [layout, setLayout] = useState<ClassroomLayout>(() => LayoutStorage.getLocalCachedLayout());
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const [focusDevice, setFocusDevice] = useState<StudentDevice | null>(null);
  const [specsDevice, setSpecsDevice] = useState<StudentDevice | null>(null);
  const [editingSeat, setEditingSeat] = useState<StudentDevice | null>(null);
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [isMatrixConfigOpen, setIsMatrixConfigOpen] = useState(false);
  const [isDevicePoolOpen, setIsDevicePoolOpen] = useState(false);
  // Viewport Zoom & Pan Persistence (localStorage)
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const savedZoom = localStorage.getItem('gridsight_viewport_zoom');
      if (savedZoom) {
        const val = parseFloat(savedZoom);
        if (!isNaN(val) && val >= 0.2 && val <= 3.0) return val;
      }
    } catch {}
    return 0.85;
  });

  const [pan, setPan] = useState<{ x: number; y: number }>(() => {
    try {
      const savedPan = localStorage.getItem('gridsight_viewport_pan');
      if (savedPan) {
        const parsed = JSON.parse(savedPan);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
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
    setZoom(0.85);
    setPan({ x: 0, y: 0 });
    try {
      localStorage.setItem('gridsight_viewport_zoom', '0.85');
      localStorage.setItem('gridsight_viewport_pan', JSON.stringify({ x: 0, y: 0 }));
    } catch {}
  };

  const [unassignedDevices, setUnassignedDevices] = useState<StudentDevice[]>([]);

  // Load layout from server SEATS_FILE on startup
  useEffect(() => {
    LayoutStorage.fetchServerLayout().then((srvLayout) => {
      if (srvLayout) {
        setLayout(srvLayout);
      }
    });
  }, []);

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

            // Match discovered agents to layout seats via strict MAC-First Primary Key Binding
            setLayout((prev) => {
              const assignedMacs = new Set<string>();
              const normMac = (m?: string) => (m ? m.replace(/[:-]/g, '').toUpperCase() : '');
              const discoveredMacMap = new Map<string, StudentDevice>();

              discovered.forEach((dev) => {
                const devKey = normMac(dev.mac);
                if (devKey) discoveredMacMap.set(devKey, dev);
              });

              // Update all current layout seats: mark offline if not in discovered
              const updatedSeats = prev.seats.map((seat) => {
                const seatMacKey = normMac(seat.mac);
                if (seatMacKey && discoveredMacMap.has(seatMacKey)) {
                  assignedMacs.add(seatMacKey);
                  const dev = discoveredMacMap.get(seatMacKey)!;
                  return {
                    ...seat,
                    ip: dev.ip,
                    hostname: dev.hostname || seat.hostname,
                    token: dev.token || seat.token,
                    mac: dev.mac || seat.mac,
                    specs: dev.specs || seat.specs,
                    status: 'online' as const,
                  };
                } else {
                  // Device is no longer broadcasting beacons -> mark offline
                  return {
                    ...seat,
                    status: 'offline' as const,
                  };
                }
              });

              // Discovered online agents NOT placed in the matrix stay in the Device Pool
              const unassigned = discovered.filter(
                (d) => !d.mac || !assignedMacs.has(normMac(d.mac))
              );
              setUnassignedDevices(unassigned);

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

  const handleBatchSelect = (ids: string[], append: boolean = false) => {
    const idSet = new Set(ids);
    setLayout((prev) => ({
      ...prev,
      seats: prev.seats.map((s) => {
        if (idSet.has(s.id)) return { ...s, selected: true };
        return append ? s : { ...s, selected: false };
      }),
    }));
  };

  const handleSelectAll = () => {
    setLayout((prev) => ({
      ...prev,
      seats: prev.seats.map((s) => ({ ...s, selected: true })),
    }));
  };

  const handleClearSelection = () => {
    setLayout((prev) => ({
      ...prev,
      seats: prev.seats.map((s) => ({ ...s, selected: false })),
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

  // Save edited seat information (SeatNo, Hostname, Username, MAC, IP)
  const handleSaveSeatInfo = (updatedSeat: StudentDevice) => {
    setLayout((prev) => {
      const updatedSeats = prev.seats.map((s) => (s.id === updatedSeat.id ? updatedSeat : s));
      const newLayout = { ...prev, seats: updatedSeats };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
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

  // Drag & Drop: Return single or multiple student cards from canvas back to Device Pool
  const handleReturnToPool = (seatIds: string | string[]) => {
    const ids = Array.isArray(seatIds) ? seatIds : [seatIds];
    if (ids.length === 0) return;
    const idSet = new Set(ids);

    setLayout((prev) => {
      const seatsToReturn = prev.seats.filter((s) => idSet.has(s.id));
      if (seatsToReturn.length === 0) return prev;

      // Add eligible devices to unassigned pool
      const newPoolEntries = seatsToReturn.filter(
        (seat) => seat.status === 'online' || seat.mac || !seat.id.startsWith('PC-Slot-')
      );

      if (newPoolEntries.length > 0) {
        setUnassignedDevices((pool) => {
          const poolMacs = new Set(pool.map((d) => d.mac?.toUpperCase()).filter(Boolean));
          const poolIds = new Set(pool.map((d) => d.id));
          const added = newPoolEntries.filter(
            (s) => !poolIds.has(s.id) && (!s.mac || !poolMacs.has(s.mac.toUpperCase()))
          );
          return [...pool, ...added];
        });
      }

      // Remove from active layout seats
      const updatedSeats = prev.seats.filter((s) => !idSet.has(s.id));
      const newLayout = { ...prev, seats: updatedSeats };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Batch action: Auto re-sequence seat numbers sequentially for selected seats
  const handleAutoRenumberSelected = () => {
    setLayout((prev) => {
      const selected = prev.seats.filter((s) => s.selected);
      if (selected.length === 0) return prev;

      // Sort selected seats row-by-row (top-to-bottom, left-to-right)
      selected.sort((a, b) => (a.gridY !== b.gridY ? a.gridY - b.gridY : a.gridX - b.gridX));

      const renumberedMap = new Map<string, string>();
      selected.forEach((seat) => {
        const rowLabel = String.fromCharCode(65 + (seat.gridY % 26));
        const newSeatNo = `${rowLabel}${seat.gridX + 1}`;
        renumberedMap.set(seat.id, newSeatNo);
      });

      const updatedSeats = prev.seats.map((s) => {
        if (renumberedMap.has(s.id)) {
          return { ...s, seatNo: renumberedMap.get(s.id)! };
        }
        return s;
      });

      const newLayout = { ...prev, seats: updatedSeats };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Batch action: Apply bulk properties / renaming to selected seats
  const handleApplyBatchEdit = (options: {
    prefixMode?: 'ROW_COL' | 'NUMBER' | 'CUSTOM';
    customPrefix?: string;
    startNumber?: number;
    clearUsernames?: boolean;
    setCommonGroup?: string;
    unbindDevices?: boolean;
  }) => {
    if (options.unbindDevices) {
      const selectedIds = layout.seats.filter((s) => s.selected).map((s) => s.id);
      handleReturnToPool(selectedIds);
      return;
    }

    setLayout((prev) => {
      const selected = prev.seats.filter((s) => s.selected);
      if (selected.length === 0) return prev;

      // Sort row-by-row
      selected.sort((a, b) => (a.gridY !== b.gridY ? a.gridY - b.gridY : a.gridX - b.gridX));

      const updatedMap = new Map<string, Partial<StudentDevice>>();
      let counter = options.startNumber || 1;

      selected.forEach((seat) => {
        let seatNo = seat.seatNo;
        if (options.prefixMode === 'ROW_COL') {
          const rowLabel = String.fromCharCode(65 + (seat.gridY % 26));
          seatNo = `${rowLabel}${seat.gridX + 1}`;
        } else if (options.prefixMode === 'NUMBER') {
          seatNo = String(counter).padStart(2, '0');
          counter++;
        } else if (options.prefixMode === 'CUSTOM') {
          seatNo = `${options.customPrefix || 'PC-'}${counter}`;
          counter++;
        }

        const changes: Partial<StudentDevice> = { seatNo };
        if (options.clearUsernames) {
          changes.username = '';
        }
        if (options.setCommonGroup) {
          changes.username = options.setCommonGroup;
        }

        updatedMap.set(seat.id, changes);
      });

      const updatedSeats = prev.seats.map((s) => {
        if (updatedMap.has(s.id)) {
          return { ...s, ...updatedMap.get(s.id)! };
        }
        return s;
      });

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
      const rowLabel = String.fromCharCode(65 + (targetGridY % 26));
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

  // Auto assign all unassigned pool devices sequentially into empty/offline seats
  const handleAutoAssign = () => {
    setLayout((prev) => {
      const updatedSeats = [...prev.seats];
      const remainingPool: StudentDevice[] = [];

      unassignedDevices.forEach((dev) => {
        // 1. Find the first empty coordinate or first offline dummy slot
        let targetIdx = updatedSeats.findIndex((s) => s.status === 'offline' && s.id.startsWith('PC-Slot-'));
        if (targetIdx === -1) {
          targetIdx = updatedSeats.findIndex((s) => s.status === 'offline');
        }

        if (targetIdx !== -1) {
          const oldSeat = updatedSeats[targetIdx];
          updatedSeats[targetIdx] = {
            ...dev,
            gridX: oldSeat.gridX,
            gridY: oldSeat.gridY,
            seatNo: oldSeat.seatNo,
            status: 'online',
            selected: false,
          };
        } else {
          // If all current seats are occupied, find next open grid coordinate
          const occupied = new Set(updatedSeats.map((s) => `${s.gridX},${s.gridY}`));
          let placed = false;
          for (let r = 0; r < prev.rows; r++) {
            for (let c = 0; c < prev.cols; c++) {
              const key = `${c},${r}`;
              if (!occupied.has(key)) {
                occupied.add(key);
                const rowLabel = String.fromCharCode(65 + (r % 26));
                updatedSeats.push({
                  ...dev,
                  gridX: c,
                  gridY: r,
                  seatNo: `${rowLabel}${c + 1}`,
                  status: 'online',
                  selected: false,
                });
                placed = true;
                break;
              }
            }
            if (placed) break;
          }
          if (!placed) {
            remainingPool.push(dev);
          }
        }
      });

      setUnassignedDevices(remainingPool);
      const newLayout = { ...prev, seats: updatedSeats };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  const handleAssignToFirstAvailable = (device: StudentDevice) => {
    setLayout((prev) => {
      const occupiedCoords = new Set(prev.seats.map((s) => `${s.gridX},${s.gridY}`));
      let targetX = 0;
      let targetY = 0;
      let found = false;

      for (let r = 0; r < prev.rows; r++) {
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

      const rowLabel = String.fromCharCode(65 + (targetY % 26));
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
        if (seat.gridX < cols && seat.gridY < rows) {
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

      const newLayout: ClassroomLayout = {
        id: `layout-matrix-${cols}x${rows}-${Date.now()}`,
        name: name || `標準矩陣 (${cols}×${rows}, ${cols * rows}席位)`,
        cols: Math.max(cols, 4),
        rows,
        seats: withinBounds, // Keep only actual assigned devices, unassigned slots remain clean & empty
        aisles: [],
        obstacles: [],
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
        onOpenMatrixConfig={() => setIsMatrixConfigOpen(true)}
        onOpenDevicePool={() => setIsDevicePoolOpen(true)}
        unassignedCount={unassignedDevices.length}
        zoom={zoom}
        setZoom={setZoom}
        onResetView={handleResetView}
        onLock={() => setIsLocked(true)}
        onOpenChangePin={() => setIsChangePinOpen(true)}
        trafficStats={trafficStats}
      />

      <GridCanvas
        layout={layout}
        mode={mode}
        zoom={zoom}
        pan={pan}
        setPan={setPan}
        setZoom={setZoom}
        onSelectStudent={handleSelectStudent}
        onBatchSelect={handleBatchSelect}
        onClearSelection={handleClearSelection}
        onSelectAll={handleSelectAll}
        onFocusStudent={setFocusDevice}
        onRefreshAuth={handleRefreshAuth}
        onUnbindSeat={handleUnbindSeat}
        onOpenSpecs={setSpecsDevice}
        onEditSeat={(device) => setEditingSeat(device)}
        onVisibleSeatsChange={(ids) => {
          visibleDeviceIdsRef.current = ids;
        }}
        onSwapSeats={handleSwapSeats}
        onMoveSeat={handleMoveSeat}
        onAssignFromPool={handleAssignFromPool}
      />

      {/* Multi-Selection Batch Action Floating Toolbar */}
      {mode === 'EDIT_LAYOUT' && (
        <BatchActionToolbar
          selectedSeats={layout.seats.filter((s) => s.selected)}
          onReturnToPool={handleReturnToPool}
          onOpenBatchEdit={() => setIsBatchEditOpen(true)}
          onAutoRenumber={handleAutoRenumberSelected}
          onClearSelection={handleClearSelection}
          onSelectAll={handleSelectAll}
          totalSeatsCount={layout.seats.length}
        />
      )}

      {/* Batch Edit Modal */}
      <BatchEditModal
        isOpen={isBatchEditOpen}
        selectedSeats={layout.seats.filter((s) => s.selected)}
        onClose={() => setIsBatchEditOpen(false)}
        onApplyBatchEdit={handleApplyBatchEdit}
      />

      {/* Edit Single Seat Information Modal (SeatNo, Hostname, Username, MAC) */}
      <EditSeatModal
        isOpen={!!editingSeat}
        seat={editingSeat}
        unassignedDevices={unassignedDevices}
        onClose={() => setEditingSeat(null)}
        onSaveSeat={handleSaveSeatInfo}
        onUnbindSeat={handleUnbindSeat}
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
