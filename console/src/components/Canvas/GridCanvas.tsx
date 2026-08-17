import React, { useRef, useState } from 'react';
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
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

        {/* Render 70 Student Cards */}
        {layout.seats.map((seat) => (
          <div
            key={seat.id}
            style={{
              position: 'absolute',
              left: seat.gridX * (cardWidth + gap),
              top: seat.gridY * (cardHeight + gap),
              width: cardWidth,
              height: cardHeight,
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
            />
          </div>
        ))}
      </div>

      {/* Mini-map Overlay */}
      <MiniMap layout={layout} />
    </div>
  );
};
