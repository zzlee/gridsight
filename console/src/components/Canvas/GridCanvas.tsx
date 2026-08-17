import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ClassroomLayout, StudentDevice, AppMode } from '../../types';
import { StudentCard } from './StudentCard';
import { AisleMarker } from './AisleMarker';
import { ObstacleMarker } from './ObstacleMarker';
import { MiniMap } from './MiniMap';

interface GridCanvasProps {
  layout: ClassroomLayout;
  mode: AppMode;
  zoom: number;
  onSelectStudent: (id: string, multi: boolean) => void;
  onFocusStudent: (device: StudentDevice) => void;
  onRefreshAuth: (device: StudentDevice) => void;
  onUnbindSeat: (id: string) => void;
  onOpenSpecs?: (device: StudentDevice) => void;
  onVisibleSeatsChange?: (visibleIds: Set<string>) => void;
  onSwapSeats?: (idA: string, idB: string) => void;
  onMoveSeat?: (id: string, newGridX: number, newGridY: number) => void;
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
  onVisibleSeatsChange,
  onSwapSeats,
  onMoveSeat,
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
    // In edit mode or monitor mode, Middle-click or Alt+Left-click triggers canvas panning
    if (e.button === 1 || (e.button === 0 && (e.altKey || (mode === 'MONITOR' && e.target === containerRef.current)))) {
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

  // Handle Drag Events for Cards
  const handleCardDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
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
    const sourceId = e.dataTransfer.getData('text/plain') || draggedSeatId;
    if (sourceId && sourceId !== targetId && onSwapSeats) {
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
    const sourceId = e.dataTransfer.getData('text/plain') || draggedSeatId;
    if (sourceId && onMoveSeat) {
      onMoveSeat(sourceId, x, y);
    }
    setDraggedSeatId(null);
    setDragOverSeatId(null);
    setDragOverCell(null);
  };

  // Create lookup set for occupied grid cells
  const occupiedCells = new Set(layout.seats.map((s) => `${s.gridX},${s.gridY}`));

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
        {/* In Edit Mode: Render Drop-Target Grid Matrix for Empty Cells */}
        {mode === 'EDIT_LAYOUT' && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: layout.rows + 2 }).map((_, r) =>
              Array.from({ length: layout.cols + 2 }).map((_, c) => {
                const key = `${c},${r}`;
                const isOccupied = occupiedCells.has(key);
                const isTarget = dragOverCell && dragOverCell.x === c && dragOverCell.y === r;

                return (
                  <div
                    key={key}
                    onDragOver={(e) => handleCellDragOver(e, c, r)}
                    onDrop={(e) => handleCellDrop(e, c, r)}
                    className={`absolute rounded-lg border transition-colors ${
                      isOccupied
                        ? 'border-transparent pointer-events-none'
                        : isTarget
                        ? 'border-sky-400 bg-sky-500/20 ring-2 ring-sky-400 pointer-events-auto'
                        : 'border-slate-800/40 border-dashed bg-slate-900/20 hover:border-slate-700/60 pointer-events-auto'
                    }`}
                    style={{
                      left: c * (cardWidth + gap),
                      top: r * (cardHeight + gap),
                      width: cardWidth,
                      height: cardHeight,
                    }}
                  >
                    {!isOccupied && (
                      <div className="w-full h-full flex items-center justify-center text-[11px] font-mono text-slate-700 select-none">
                        [{c},{r}]
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Render Obstacles (e.g. Teacher Podium / Blackboard) */}
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

        {/* Render Aisles */}
        {layout.aisles.map((aisle) => (
          <div
            key={aisle.id}
            style={{
              position: 'absolute',
              left: aisle.type === 'vertical' ? aisle.index * (cardWidth + gap) : 0,
              top: aisle.type === 'horizontal' ? aisle.index * (cardHeight + gap) : (cardHeight + gap),
              width: aisle.type === 'vertical' ? cardWidth : layout.cols * (cardWidth + gap),
              height: aisle.type === 'horizontal' ? cardHeight : (layout.rows - 1) * (cardHeight + gap),
            }}
          >
            <AisleMarker aisle={aisle} />
          </div>
        ))}

        {/* Render Student Cards */}
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
