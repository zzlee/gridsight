import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { ClassroomLayout, StudentDevice, AppMode, GridObstacle } from '../../types';
import { StudentCard } from './StudentCard';
import { ObstacleMarker } from './ObstacleMarker';
import { MiniMap } from './MiniMap';
import { Monitor, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface GridCanvasProps {
  layout: ClassroomLayout;
  mode: AppMode;
  zoom: number;
  pan: { x: number; y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  setZoom?: React.Dispatch<React.SetStateAction<number>>;
  onResetView?: () => void;
  onSelectStudent: (id: string, multi: boolean) => void;
  onBatchSelect?: (ids: string[], append?: boolean) => void;
  onClearSelection?: () => void;
  onSelectAll?: () => void;
  onFocusStudent: (device: StudentDevice) => void;
  onUnbindSeat: (id: string) => void;
  onOpenSpecs?: (device: StudentDevice) => void;
  onEditSeat?: (device: StudentDevice) => void;
  onVisibleSeatsChange?: (visibleIds: Set<string>) => void;
  onSwapSeats?: (idA: string, idB: string) => void;
  onMoveSeat?: (id: string, newGridX: number, newGridY: number) => void;
  onAssignFromPool?: (deviceId: string, targetGridX: number, targetGridY: number) => void;
  filterOnlyOffTask?: boolean;
  onEditObstacle?: (obstacle: GridObstacle) => void;
  onDeleteObstacle?: (id: string) => void;
}

export const GridCanvas: React.FC<GridCanvasProps> = ({
  layout,
  mode,
  zoom,
  pan,
  setPan,
  setZoom,
  onResetView,
  onSelectStudent,
  onBatchSelect,
  onClearSelection,
  onSelectAll,
  onFocusStudent,
  onUnbindSeat,
  onOpenSpecs,
  onEditSeat,
  onVisibleSeatsChange,
  onSwapSeats,
  onMoveSeat,
  onAssignFromPool,
  filterOnlyOffTask = false,
  onEditObstacle,
  onDeleteObstacle,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  // Marquee / Box Selection state
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxCurrent, setBoxCurrent] = useState<{ x: number; y: number } | null>(null);

  // Drag-and-drop state for editing layout
  const [draggedSeatId, setDraggedSeatId] = useState<string | null>(null);
  const [dragOverSeatId, setDragOverSeatId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ x: number; y: number } | null>(null);

  // Card dimensions (16:9 ratio card matching 480x270 thumbnail)
  const cardWidth = 190;
  const cardHeight = 150;
  const gap = 14;
  const aisleGap = 36; // Visual extra width/height added by aisles

  // Precompute prefix sums of vertical and horizontal aisles for O(1) visual coordinate lookups
  const vAislePrefix = useMemo(() => {
    const vAisles = (layout.aisles || []).filter((a) => a.type === 'vertical');
    const maxCol = Math.max(layout.cols || 0, ...vAisles.map((a) => a.index + 1), 100);
    const prefix = new Int32Array(maxCol + 1);
    for (const a of vAisles) {
      if (a.index + 1 >= 0 && a.index + 1 <= maxCol) {
        prefix[a.index + 1]++;
      }
    }
    for (let i = 1; i <= maxCol; i++) {
      prefix[i] += prefix[i - 1];
    }
    return prefix;
  }, [layout.aisles, layout.cols]);

  const hAislePrefix = useMemo(() => {
    const hAisles = (layout.aisles || []).filter((a) => a.type === 'horizontal');
    const maxRow = Math.max(layout.rows || 0, ...hAisles.map((a) => a.index + 1), 100);
    const prefix = new Int32Array(maxRow + 1);
    for (const a of hAisles) {
      if (a.index + 1 >= 0 && a.index + 1 <= maxRow) {
        prefix[a.index + 1]++;
      }
    }
    for (let i = 1; i <= maxRow; i++) {
      prefix[i] += prefix[i - 1];
    }
    return prefix;
  }, [layout.aisles, layout.rows]);

  // Calculate actual pixel positions with aisle gaps in O(1) time
  const getVisualX = useCallback(
    (col: number) => {
      const count = col <= 0 ? 0 : col < vAislePrefix.length ? vAislePrefix[col] : vAislePrefix[vAislePrefix.length - 1];
      return col * (cardWidth + gap) + count * aisleGap;
    },
    [vAislePrefix]
  );

  const getVisualY = useCallback(
    (row: number) => {
      const count = row <= 0 ? 0 : row < hAislePrefix.length ? hAislePrefix[row] : hAislePrefix[hAislePrefix.length - 1];
      return row * (cardHeight + gap) + count * aisleGap;
    },
    [hAislePrefix]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle-click or Alt+Left-click triggers canvas panning
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    // Left-click on canvas background: initiate marquee box selection or background pan
    if (e.button === 0 && (e.target === containerRef.current || (e.target as HTMLElement).classList.contains('canvas-background-area'))) {
      if (mode === 'EDIT_LAYOUT' || e.shiftKey) {
        setIsBoxSelecting(true);
        setBoxStart({ x: e.clientX, y: e.clientY });
        setBoxCurrent({ x: e.clientX, y: e.clientY });
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && onClearSelection) {
          onClearSelection();
        }
      } else {
        setIsPanning(true);
        setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
    } else if (isBoxSelecting && boxStart && containerRef.current) {
      setBoxCurrent({ x: e.clientX, y: e.clientY });

      const containerRect = containerRef.current.getBoundingClientRect();
      const selLeft = Math.min(boxStart.x, e.clientX) - containerRect.left;
      const selRight = Math.max(boxStart.x, e.clientX) - containerRect.left;
      const selTop = Math.min(boxStart.y, e.clientY) - containerRect.top;
      const selBottom = Math.max(boxStart.y, e.clientY) - containerRect.top;

      // Find all seat cards intersecting the screen selection rectangle
      const intersectingIds: string[] = [];
      layout.seats.forEach((seat) => {
        const cardLeft = getVisualX(seat.gridX) * zoom + (pan.x + 30);
        const cardTop = getVisualY(seat.gridY) * zoom + (pan.y + 20);
        const cardRight = cardLeft + cardWidth * zoom;
        const cardBottom = cardTop + cardHeight * zoom;

        const intersects = !(
          cardLeft > selRight ||
          cardRight < selLeft ||
          cardTop > selBottom ||
          cardBottom < selTop
        );

        if (intersects) {
          intersectingIds.push(seat.id);
        }
      });

      if (onBatchSelect) {
        onBatchSelect(intersectingIds, e.shiftKey || e.ctrlKey || e.metaKey);
      }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setIsBoxSelecting(false);
    setBoxStart(null);
    setBoxCurrent(null);
  };

  // Keyboard shortcut listener for Select All (Ctrl+A) and Deselect (Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const activeEl = document.activeElement;
        const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
        if (!isInput && onSelectAll) {
          e.preventDefault();
          onSelectAll();
        }
      } else if (e.key === 'Escape') {
        if (onClearSelection) {
          onClearSelection();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectAll, onClearSelection]);

  // Set of visible seat IDs for DOM culling inside the canvas viewport
  const [visibleSeatIds, setVisibleSeatIds] = useState<Set<string>>(() => new Set());
  const prevVisibleSetRef = useRef<Set<string>>(new Set());
  const rafIdRef = useRef<number | null>(null);

  // Viewport calculation: determine which seats are inside the visible canvas viewport
  const calculateVisibleSeats = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const viewportWidth = container.clientWidth || window.innerWidth;
    const viewportHeight = container.clientHeight || window.innerHeight;

    const visibleDomSet = new Set<string>();
    const visibleNetworkSet = new Set<string>();
    const margin = 150; // Buffer margin in screen pixels for smooth panning pre-render

    layout.seats.forEach((seat) => {
      const cardLeft = getVisualX(seat.gridX);
      const cardTop = getVisualY(seat.gridY);
      const cardRight = cardLeft + cardWidth;
      const cardBottom = cardTop + cardHeight;

      // Project world coordinates to screen coordinates
      const screenLeft = cardLeft * zoom + (pan.x + 30);
      const screenTop = cardTop * zoom + (pan.y + 20);
      const screenRight = cardRight * zoom + (pan.x + 30);
      const screenBottom = cardBottom * zoom + (pan.y + 20);

      // Check if card bounding box intersects with viewport bounding box
      const isVisible =
        screenRight >= -margin &&
        screenLeft <= viewportWidth + margin &&
        screenBottom >= -margin &&
        screenTop <= viewportHeight + margin;

      if (isVisible) {
        visibleDomSet.add(seat.id);
        visibleNetworkSet.add(seat.id);
        if (seat.mac) visibleNetworkSet.add(seat.mac);
      }
    });

    // Set Equality Guard to prevent redundant state updates
    let isDomChanged = visibleDomSet.size !== visibleSeatIds.size;
    if (!isDomChanged) {
      for (const id of visibleDomSet) {
        if (!visibleSeatIds.has(id)) {
          isDomChanged = true;
          break;
        }
      }
    }
    if (isDomChanged) {
      setVisibleSeatIds(visibleDomSet);
    }

    if (onVisibleSeatsChange) {
      const prevSet = prevVisibleSetRef.current;
      let isNetworkChanged = visibleNetworkSet.size !== prevSet.size;
      if (!isNetworkChanged) {
        for (const item of visibleNetworkSet) {
          if (!prevSet.has(item)) {
            isNetworkChanged = true;
            break;
          }
        }
      }
      if (isNetworkChanged) {
        prevVisibleSetRef.current = visibleNetworkSet;
        onVisibleSeatsChange(visibleNetworkSet);
      }
    }
  }, [layout.seats, pan, zoom, onVisibleSeatsChange, getVisualX, getVisualY, visibleSeatIds]);

  // RAF Throttled calculation on pan/zoom/resize
  useEffect(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      calculateVisibleSeats();
    });
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [calculateVisibleSeats]);

  useEffect(() => {
    const handleResize = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = requestAnimationFrame(() => {
        calculateVisibleSeats();
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [calculateVisibleSeats]);

  // Reset any residual drag state globally when drag ends or drops anywhere
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setDraggedSeatId(null);
      setDragOverSeatId(null);
      setDragOverCell(null);
    };

    window.addEventListener('dragend', handleGlobalDragEnd);
    window.addEventListener('drop', handleGlobalDragEnd);
    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd);
      window.removeEventListener('drop', handleGlobalDragEnd);
    };
  }, []);

  // Handle Drag Events for Cards
  const handleCardDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.setData('source', 'canvas-seat');
    e.dataTransfer.effectAllowed = 'move';

    // If dragged card is part of multi-selection, attach all selected seat IDs
    const currentSelected = layout.seats.filter((s) => s.selected).map((s) => s.id);
    const allDraggedIds = currentSelected.includes(id) ? currentSelected : [id];
    e.dataTransfer.setData('selectedIds', JSON.stringify(allDraggedIds));

    setDraggedSeatId(id);
  };

  const handleCardDragEnd = () => {
    setDraggedSeatId(null);
    setDragOverSeatId(null);
    setDragOverCell(null);
  };

  const handleCardDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverSeatId !== id) {
      setDragOverSeatId(id);
    }
  };

  const handleCardDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverSeatId(null);
  };

  const handleCardDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const source = e.dataTransfer.getData('source');
    const sourceId = e.dataTransfer.getData('text/plain') || draggedSeatId;
    const targetSeat = layout.seats.find((s) => s.id === targetId);

    if (source === 'device-pool') {
      if (sourceId && targetSeat && onAssignFromPool) {
        onAssignFromPool(sourceId, targetSeat.gridX, targetSeat.gridY);
      }
    } else if (sourceId && sourceId !== targetId && onSwapSeats) {
      onSwapSeats(sourceId, targetId);
    }

    setDraggedSeatId(null);
    setDragOverSeatId(null);
    setDragOverCell(null);
  };

  // Handle Drag Over Empty Grid Cells in Edit Mode
  const handleCellDragOver = (e: React.DragEvent, x: number, y: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragOverCell || dragOverCell.x !== x || dragOverCell.y !== y) {
      setDragOverCell({ x, y });
    }
  };

  const handleCellDrop = (e: React.DragEvent, x: number, y: number) => {
    e.preventDefault();
    const source = e.dataTransfer.getData('source');
    const sourceId = e.dataTransfer.getData('text/plain') || draggedSeatId;

    if (source === 'device-pool') {
      if (sourceId && onAssignFromPool) {
        onAssignFromPool(sourceId, x, y);
      }
    } else if (sourceId && onMoveSeat) {
      onMoveSeat(sourceId, x, y);
    }

    setDraggedSeatId(null);
    setDragOverSeatId(null);
    setDragOverCell(null);
  };

  // Create lookup set for occupied grid cells
  const occupiedCells = new Set(layout.seats.map((s) => `${s.gridX},${s.gridY}`));

  // Matrix bounds
  const totalCols = layout.cols;
  const totalRows = layout.rows;

  const handleWheel = (e: React.WheelEvent) => {
    if ((e.ctrlKey || e.metaKey) && setZoom) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setZoom((z) => Math.min(3.0, Math.max(0.2, Math.round((z + delta) * 100) / 100)));
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      className={`relative w-full h-[calc(100vh-3.5rem)] bg-slate-950 overflow-hidden ${
        isPanning ? 'cursor-grabbing' : 'cursor-default'
      }`}
    >
      {/* Background Dot Grid Pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: 'radial-gradient(circle, #38bdf8 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      />

      {/* Main Canvas Transformation Container */}
      <div
        className="absolute transition-transform duration-75"
        style={{
          transform: `translate(${pan.x + 30}px, ${pan.y + 20}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Render Drop-Target Grid Matrix for Empty Cells */}
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: totalRows }).map((_, r) => {
            return Array.from({ length: totalCols }).map((_, c) => {
              const key = `${c},${r}`;
              const isOccupied = occupiedCells.has(key);
              if (isOccupied) return null;

              const isTarget = dragOverCell && dragOverCell.x === c && dragOverCell.y === r;
              const rowLabel = String.fromCharCode(65 + (r % 26));

              const isInteractive = mode === 'EDIT_LAYOUT' || draggedSeatId;

              return (
                <div
                  key={key}
                  onDragOver={(e) => handleCellDragOver(e, c, r)}
                  onDrop={(e) => handleCellDrop(e, c, r)}
                  className={`absolute rounded-lg border transition-all ${
                    isInteractive
                      ? isTarget
                        ? 'border-sky-400 bg-sky-500/30 ring-2 ring-sky-400 pointer-events-auto scale-105 shadow-lg'
                        : 'border-slate-800/80 border-dashed bg-slate-900/30 hover:border-sky-500/50 hover:bg-slate-900/60 pointer-events-auto'
                      : 'border-slate-900/80 bg-slate-950/40 pointer-events-none'
                  }`}
                  style={{
                    left: getVisualX(c),
                    top: getVisualY(r),
                    width: cardWidth,
                    height: cardHeight,
                  }}
                >
                  <div className="w-full h-full flex flex-col items-center justify-center select-none space-y-1">
                    <span className="px-2 py-0.5 rounded bg-slate-900/80 border border-slate-800 text-xs font-mono font-semibold text-slate-500">
                      {rowLabel}{c + 1}
                    </span>
                    <Monitor className="w-5 h-5 text-slate-700 opacity-40" />
                    <span className="text-[10px] text-slate-600 font-medium">
                      {isInteractive ? '可放置席位' : '空白席位'}
                    </span>
                  </div>
                </div>
              );
            });
          })}
        </div>

        {/* Render Vertical Aisles Pathways */}
        {(layout.aisles || [])
          .filter((a) => a.type === 'vertical')
          .map((aisle) => {
            const aisleLeft = getVisualX(aisle.index) + cardWidth + gap / 2;
            const aisleHeight = getVisualY(totalRows - 1) + cardHeight;
            return (
              <div
                key={aisle.id}
                className="absolute flex flex-col items-center justify-center pointer-events-none"
                style={{
                  left: aisleLeft,
                  top: 0,
                  width: aisleGap,
                  height: aisleHeight,
                }}
              >
                <div className="h-full w-px border-l-2 border-dashed border-sky-500/25" />
                <span className="absolute px-1.5 py-0.5 rounded bg-sky-950/90 border border-sky-800/70 text-[9px] text-sky-400 font-mono rotate-90 tracking-wider whitespace-nowrap shadow-sm">
                  {aisle.label || '走道'}
                </span>
              </div>
            );
          })}

        {/* Render Horizontal Aisles Pathways */}
        {(layout.aisles || [])
          .filter((a) => a.type === 'horizontal')
          .map((aisle) => {
            const aisleTop = getVisualY(aisle.index) + cardHeight + gap / 2;
            const aisleWidth = getVisualX(totalCols - 1) + cardWidth;
            return (
              <div
                key={aisle.id}
                className="absolute flex items-center justify-center pointer-events-none"
                style={{
                  left: 0,
                  top: aisleTop,
                  width: aisleWidth,
                  height: aisleGap,
                }}
              >
                <div className="w-full h-px border-t-2 border-dashed border-amber-500/25" />
                <span className="absolute px-2 py-0.5 rounded bg-amber-950/90 border border-amber-800/70 text-[9px] text-amber-400 font-mono tracking-wider whitespace-nowrap shadow-sm">
                  {aisle.label || '通道'}
                </span>
              </div>
            );
          })}

        {/* Render Obstacles / Podium */}
        {(layout.obstacles || []).map((obs) => {
          const left = getVisualX(obs.gridX);
          const top = getVisualY(obs.gridY);
          const width = getVisualX(obs.gridX + obs.width - 1) + cardWidth - left;
          const height = getVisualY(obs.gridY + obs.height - 1) + cardHeight - top;

          return (
            <div
              key={obs.id}
              style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                zIndex: 10,
              }}
            >
              <ObstacleMarker
                obstacle={obs}
                isEditMode={mode === 'EDIT_LAYOUT'}
                onEdit={onEditObstacle}
                onDelete={onDeleteObstacle}
              />
            </div>
          );
        })}

        {/* Render Assigned Student Cards (DOM Viewport Virtualization) */}
        {layout.seats.map((seat) => {
          const isDimmed = filterOnlyOffTask && !seat.isOffTask;
          const isVisibleInDom = visibleSeatIds.has(seat.id);

          return (
            <div
              key={seat.id}
              className={`transition-all duration-200 ${
                isDimmed ? 'opacity-20 grayscale hover:opacity-100 hover:grayscale-0' : 'opacity-100'
              }`}
              style={{
                position: 'absolute',
                left: getVisualX(seat.gridX),
                top: getVisualY(seat.gridY),
                width: cardWidth,
                height: cardHeight,
                zIndex: draggedSeatId === seat.id ? 50 : 1,
              }}
            >
              {isVisibleInDom ? (
                <StudentCard
                  device={seat}
                  isEditMode={mode === 'EDIT_LAYOUT'}
                  onSelect={onSelectStudent}
                  onDoubleClick={onFocusStudent}
                  onUnbind={onUnbindSeat}
                  onOpenSpecs={onOpenSpecs}
                  onEditSeat={onEditSeat}
                  onDragStart={handleCardDragStart}
                  onDragEnd={handleCardDragEnd}
                  onDragOver={handleCardDragOver}
                  onDragLeave={handleCardDragLeave}
                  onDrop={handleCardDrop}
                  isDragging={draggedSeatId === seat.id}
                  isDragOver={dragOverSeatId === seat.id}
                />
              ) : (
                <div
                  className="w-full h-full rounded-lg border border-slate-900/60 bg-slate-950/40 flex flex-col items-center justify-center select-none pointer-events-none opacity-40 card-containment"
                  aria-hidden="true"
                >
                  <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-600">
                    {seat.seatNo || seat.hostname}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Marquee Drag-Box Selection Rectangle Overlay */}
      {isBoxSelecting && boxStart && boxCurrent && containerRef.current && (
        <div
          className="absolute border-2 border-sky-400 bg-sky-500/20 rounded pointer-events-none z-50 shadow-lg shadow-sky-500/10"
          style={{
            left: Math.min(boxStart.x, boxCurrent.x) - containerRef.current.getBoundingClientRect().left,
            top: Math.min(boxStart.y, boxCurrent.y) - containerRef.current.getBoundingClientRect().top,
            width: Math.abs(boxCurrent.x - boxStart.x),
            height: Math.abs(boxCurrent.y - boxStart.y),
          }}
        />
      )}

      {/* Floating Viewport Zoom & Reset Controls (Bottom-Right) */}
      <div className="absolute bottom-4 right-4 z-40 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-1 shadow-2xl flex items-center space-x-1 select-none">
        {setZoom && (
          <>
            <button
              onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title="縮小畫布 (或 Ctrl + 滑鼠滾輪)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono w-11 text-center text-slate-300 font-semibold">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              title="放大畫布 (或 Ctrl + 滑鼠滾輪)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </>
        )}
        {onResetView && (
          <button
            onClick={onResetView}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-sky-400 transition-colors border-l border-slate-800 pl-2"
            title="重置視角與縮放 (100%)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Mini-map Overlay */}
      <MiniMap layout={layout} />
    </div>
  );
};
