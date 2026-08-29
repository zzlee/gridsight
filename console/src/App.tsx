import React, { useState, useRef } from 'react';
import { StudentDevice, AppMode, GridAisle, GridObstacle } from './types';
import { TopNav } from './components/Toolbar/TopNav';
import { GridCanvas } from './components/Canvas/GridCanvas';
import { FocusModal } from './components/Viewer/FocusModal';
import { DeviceSpecsModal } from './components/Viewer/DeviceSpecsModal';
import { MatrixConfigModal } from './components/Toolbar/MatrixConfigModal';
import { AisleConfigModal } from './components/Toolbar/AisleConfigModal';
import { ObstacleModal } from './components/Toolbar/ObstacleModal';
import { EditSeatModal } from './components/Toolbar/EditSeatModal';
import { BatchActionToolbar } from './components/Toolbar/BatchActionToolbar';
import { BatchEditModal } from './components/Toolbar/BatchEditModal';
import { DevicePool } from './components/Toolbar/DevicePool';
import { AuthLockModal } from './components/Auth/AuthLockModal';
import { ChangePinModal } from './components/Auth/ChangePinModal';
import { StudentConnectModal } from './components/Toolbar/StudentConnectModal';
import { AlertSettingsModal } from './components/Toolbar/AlertSettingsModal';
import { ShareUrlModal } from './components/Toolbar/ShareUrlModal';
import { ShareFileModal } from './components/Toolbar/ShareFileModal';
import { BroadcastTestModal } from './components/Toolbar/BroadcastTestModal';
import { PollingManager } from './services/pollingManager';
import { LayoutStorage } from './services/layoutStorage';
import { useViewport } from './hooks/useViewport';
import { useOffTaskAlerts } from './hooks/useOffTaskAlerts';
import { useAgentDiscovery } from './hooks/useAgentDiscovery';

const pollingManager = new PollingManager();

export const App: React.FC = () => {
  const visibleDeviceIdsRef = useRef<Set<string>>(new Set());
  const [isChangePinOpen, setIsChangePinOpen] = useState(false);
  const [mode, setMode] = useState<AppMode>('MONITOR');

  const [focusDevice, setFocusDevice] = useState<StudentDevice | null>(null);
  const [specsDevice, setSpecsDevice] = useState<StudentDevice | null>(null);
  const [editingSeat, setEditingSeat] = useState<StudentDevice | null>(null);

  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [isMatrixConfigOpen, setIsMatrixConfigOpen] = useState(false);
  const [isAisleConfigOpen, setIsAisleConfigOpen] = useState(false);
  const [isObstacleModalOpen, setIsObstacleModalOpen] = useState(false);
  const [isDevicePoolOpen, setIsDevicePoolOpen] = useState(false);
  const [isStudentConnectOpen, setIsStudentConnectOpen] = useState(false);
  const [isAlertSettingsOpen, setIsAlertSettingsOpen] = useState(false);
  const [isShareUrlOpen, setIsShareUrlOpen] = useState(false);
  const [isShareFileOpen, setIsShareFileOpen] = useState(false);
  const [isBroadcastTestOpen, setIsBroadcastTestOpen] = useState(false);

  // Viewport Zoom & Pan Persistence
  const { zoom, setZoom, pan, setPan, handleResetView } = useViewport();

  // Off-Task Alert & Active Window Monitoring State
  const {
    alertsEnabled,
    offTaskKeywords,
    setOffTaskKeywords,
    filterOnlyOffTask,
    setFilterOnlyOffTask,
    isOffTaskMatch,
    handleUpdateKeywords,
    handleToggleAlertsEnabled,
  } = useOffTaskAlerts((updateFn) => {
    setLayout(updateFn);
  });

  // Agent Discovery, Layout State & Polling Manager
  const {
    isLocked,
    setIsLocked,
    layout,
    setLayout,
    trafficStats,
    unassignedDevices,
    setUnassignedDevices,
  } = useAgentDiscovery({
    mode,
    alertsEnabled,
    offTaskKeywords,
    isOffTaskMatch,
    setOffTaskKeywords,
    pollingManager,
    visibleDeviceIdsRef,
    setFocusDevice,
    setSpecsDevice,
  });

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

  // Save classroom aisles configuration
  const handleSaveAisles = (aisles: GridAisle[]) => {
    setLayout((prev) => {
      const newLayout = { ...prev, aisles };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Save classroom obstacles / podium configuration
  const handleSaveObstacles = (obstacles: GridObstacle[]) => {
    setLayout((prev) => {
      const newLayout = { ...prev, obstacles };
      LayoutStorage.saveLayout(newLayout);
      return newLayout;
    });
  };

  // Quick delete single obstacle
  const handleDeleteObstacle = (id: string) => {
    setLayout((prev) => {
      const newLayout = { ...prev, obstacles: (prev.obstacles || []).filter((o) => o.id !== id) };
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

  // Apply customizable X * Y Matrix Dimensions & Classroom Renaming
  const handleApplyMatrix = (cols: number, rows: number, name: string, keepExisting: boolean) => {
    // Keep aisles that remain within new matrix dimensions
    const validAisles = (layout.aisles || []).filter((a) => {
      if (a.type === 'vertical') return a.index < cols - 1;
      if (a.type === 'horizontal') return a.index < rows - 1;
      return true;
    });

    // Keep obstacles that remain within new matrix dimensions
    const validObstacles = (layout.obstacles || []).filter((o) => {
      return o.gridX < cols && o.gridY < rows;
    });

    if (!keepExisting) {
      // Move all current online devices into unassigned pool
      const onlineAssigned = layout.seats.filter((s) => s.status === 'online');
      setUnassignedDevices((prev) => {
        const poolIps = new Set(prev.map((d) => d.ip));
        const added = onlineAssigned.filter((d) => !poolIps.has(d.ip));
        return [...prev, ...added];
      });

      const newLayout = {
        id: `layout-matrix-${cols}x${rows}-${Date.now()}`,
        name: name.trim() || `標準矩陣 (${cols}×${rows}, ${cols * rows}席位)`,
        cols: Math.max(cols, 4),
        rows,
        seats: [],
        aisles: validAisles,
        obstacles: validObstacles,
      };
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

      const newLayout = {
        id: layout.id || `layout-matrix-${cols}x${rows}-${Date.now()}`,
        name: name.trim() || layout.name || `標準矩陣 (${cols}×${rows}, ${cols * rows}席位)`,
        cols: Math.max(cols, 4),
        rows,
        seats: withinBounds, // Keep only actual assigned devices, unassigned slots remain clean & empty
        aisles: validAisles,
        obstacles: validObstacles,
      };

      setLayout(newLayout);
      LayoutStorage.saveLayout(newLayout);
    }
  };

  // If user opens http://<IP>:3000/join, render dedicated student onboarding portal directly
  if (typeof window !== 'undefined' && (window.location.pathname.startsWith('/join') || window.location.pathname.startsWith('/connect') || window.location.pathname.startsWith('/student'))) {
    return <StudentConnectModal isOpen={true} isStandalonePage={true} onClose={() => {}} />;
  }

  const offTaskDevices = layout.seats.filter((s) => s.status !== 'offline' && s.isOffTask);
  const selectedSeats = layout.seats.filter((s) => s.selected);
  const selectedTargets = selectedSeats.map((s) => s.mac || s.ip).filter((t): t is string => Boolean(t));
  const totalOnlineCount = layout.seats.filter((s) => s.status === 'online').length;

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 overflow-hidden">
      <TopNav
        mode={mode}
        setMode={setMode}
        layout={layout}
        onOpenMatrixConfig={() => setIsMatrixConfigOpen(true)}
        onOpenAisleConfig={() => setIsAisleConfigOpen(true)}
        onOpenObstacleModal={() => setIsObstacleModalOpen(true)}
        onOpenDevicePool={() => setIsDevicePoolOpen(true)}
        onOpenStudentConnect={() => setIsStudentConnectOpen(true)}
        onOpenAlertSettings={() => setIsAlertSettingsOpen(true)}
        onOpenShareUrl={() => setIsShareUrlOpen(true)}
        onOpenShareFile={() => setIsShareFileOpen(true)}
        onOpenBroadcastTest={() => setIsBroadcastTestOpen(true)}
        offTaskCount={offTaskDevices.length}
        unassignedCount={unassignedDevices.length}
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
        onResetView={handleResetView}
        filterOnlyOffTask={filterOnlyOffTask}
        onSelectStudent={handleSelectStudent}
        onBatchSelect={handleBatchSelect}
        onClearSelection={handleClearSelection}
        onSelectAll={handleSelectAll}
        onFocusStudent={setFocusDevice}
        onUnbindSeat={handleUnbindSeat}
        onOpenSpecs={setSpecsDevice}
        onEditSeat={(device) => setEditingSeat(device)}
        onVisibleSeatsChange={(ids) => {
          visibleDeviceIdsRef.current = ids;
        }}
        onSwapSeats={handleSwapSeats}
        onMoveSeat={handleMoveSeat}
        onAssignFromPool={handleAssignFromPool}
        onEditObstacle={() => setIsObstacleModalOpen(true)}
        onDeleteObstacle={handleDeleteObstacle}
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

      {/* Aisle Configuration Modal */}
      <AisleConfigModal
        isOpen={isAisleConfigOpen}
        onClose={() => setIsAisleConfigOpen(false)}
        layout={layout}
        onSaveAisles={handleSaveAisles}
      />

      {/* Obstacles & Teacher Podium Modal */}
      <ObstacleModal
        isOpen={isObstacleModalOpen}
        onClose={() => setIsObstacleModalOpen(false)}
        layout={layout}
        onSaveObstacles={handleSaveObstacles}
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

      {/* Student Fast Connect / Join Modal */}
      <StudentConnectModal
        isOpen={isStudentConnectOpen}
        onClose={() => setIsStudentConnectOpen(false)}
      />

      {/* Off-Task Alert & Forbidden Keywords Settings Modal */}
      <AlertSettingsModal
        isOpen={isAlertSettingsOpen}
        onClose={() => setIsAlertSettingsOpen(false)}
        keywords={offTaskKeywords}
        onUpdateKeywords={handleUpdateKeywords}
        alertsEnabled={alertsEnabled}
        onToggleAlertsEnabled={handleToggleAlertsEnabled}
        offTaskDevices={offTaskDevices}
        onFocusDevice={(d) => setFocusDevice(d)}
        filterOnlyOffTask={filterOnlyOffTask}
        onToggleFilterOnlyOffTask={setFilterOnlyOffTask}
      />

      {/* Share URL Modal */}
      <ShareUrlModal
        isOpen={isShareUrlOpen}
        onClose={() => setIsShareUrlOpen(false)}
        selectedTargets={selectedTargets}
        selectedCount={selectedSeats.length}
        totalOnlineCount={totalOnlineCount}
      />

      {/* Share File Modal */}
      <ShareFileModal
        isOpen={isShareFileOpen}
        onClose={() => setIsShareFileOpen(false)}
        selectedTargets={selectedTargets}
        selectedCount={selectedSeats.length}
        totalOnlineCount={totalOnlineCount}
      />

      {/* Broadcast Test Modal */}
      <BroadcastTestModal
        isOpen={isBroadcastTestOpen}
        onClose={() => setIsBroadcastTestOpen(false)}
      />

      {/* Security Auth Lock Modal (PIN Entry) */}
      {isLocked && (
        <AuthLockModal onUnlock={() => setIsLocked(false)} />
      )}
    </div>
  );
};
