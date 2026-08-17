import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ClassroomLayout, StudentDevice, AppMode } from '../../types';
import { StudentCard } from './StudentCard';
import { ObstacleMarker } from './ObstacleMarker';
import { MiniMap } from './MiniMap';
import { Monitor } from 'lucide-react';

interface GridCanvasProps {
  layout: ClassroomLayout;
  mode: AppMode;
  zoom: number;
  onSelectStudent: (id: string, multi: boolean) => void;
  onFocusStudent: (device: StudentDevice) => void;
  onRefreshAuth: (device: StudentDevice) => void;
  onUnbindSeat: (id: string) => void;
  onOpenSpecs?: (device: StudentDevice) => void;
  onEditSeat?: (device: StudentDevice) => void;
  onVisibleSeatsChange?: (visibleIds: Set<string>) => void;
  onSwapSeats?: (idA: string, idB: string) => void;
  onMoveSeat?: (id: string, newGridX: number, newGridY: number) => void;
  onAssignFromPool?: (deviceId: string, targetGridX: number, targetGridY: number) => void;
}

export const GridCanvas: React.FC<GridCanvasProps> = ({
  layout,
  mode,
  zoom,
  onSelectStudent,
  onFocusStudent,
  onRefreshAuth,
  onUnbindSeat,
  onOpenSpecs,
  onEditSeat,
  onVisibleSeatsChange,
  onSwapSeats,
  onMoveSeat,
  onAssignFromPool,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  // Drag-and-drop state for editing layout
  const [draggedSeatId, setDraggedSeatId] = useState<string | null>(null);
  const [dragOverSeatId, setDragOverSeatId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ x: number; y: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle-click or Alt+Left-click or background drag triggers canvas panning
    if (e.button === 1 || (e.button === 0 && (e.altKey || e.target === containerRef.current))) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Card dimensions (16:9 ratio card matching 480x270 thumbnail)
  const cardWidth = 190;
  const cardHeight = 150;
  const gap = 14;

  // Viewport calculation: determine which seats are inside the visible canvas viewport
  const calculateVisibleSeats = useCallback(() => {
    if (!containerRef.current || !onVisibleSeatsChange) return;

    const container = containerRef.current;
    const viewportWidth = container.clientWidth || window.innerWidth;
    const viewportHeight = container.clientHeight || window.innerHeight;

    const visibleSet = new Set<string>();
    const margin = 100; // Buffer margin in screen pixels for pre-fetching ahead of scrolling

    layout.seats.forEach((seat) => {
      const cardLeft = seat.gridX * (cardWidth + gap);
      const cardTop = seat.gridY * (cardHeight + gap);
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
        visibleSet.add(seat.id);
        if (seat.mac) visibleSet.add(seat.mac);
      }
    });

    onVisibleSeatsChange(visibleSet);
  }, [layout.seats, pan, zoom, onVisibleSeatsChange]);

  useEffect(() => {
    calculateVisibleSeats();
    window.addEventListener('resize', calculateVisibleSeats);
    return () => window.removeEventListener('resize', calculateVisibleSeats);
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

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
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
                    left: c * (cardWidth + gap),
                    top: r * (cardHeight + gap),
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

        {/* Render Teacher Podium Obstacles if any */}
        {layout.obstacles.map((obs) => (
          <div
            key={obs.id}
            style={{
              position: 'absolute',
              left: obs.gridX * (cardWidth + gap),
              top: obs.gridY * (cardHeight + gap),
              width: obs.width * (cardWidth + gap) - gap,
              height: obs.height * (cardHeight + gap) - gap,
            }}
          >
            <ObstacleMarker obstacle={obs} />
          </div>
        ))}

        {/* Render Assigned Student Cards */}
        {layout.seats.map((seat) => (
          <div
            key={seat.id}
            style={{
              position: 'absolute',
              left: seat.gridX * (cardWidth + gap),
              top: seat.gridY * (cardHeight + gap),
              width: cardWidth,
              height: cardHeight,
              zIndex: draggedSeatId === seat.id ? 50 : 1,
            }}
          >
            <StudentCard
              device={seat}
              isEditMode={mode === 'EDIT_LAYOUT'}
              onSelect={onSelectStudent}
              onDoubleClick={onFocusStudent}
              onRefreshAuth={onRefreshAuth}
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
          </div>
        ))}
      </div>

      {/* Mini-map Overlay */}
      <MiniMap layout={layout} />
    </div>
  );
};
