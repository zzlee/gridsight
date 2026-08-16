import React, { useEffect, useState } from 'react';
import { ClassroomLayout, StudentDevice, AppMode, BroadcastConfig } from './types';
import { TopNav } from './components/Toolbar/TopNav';
import { GridCanvas } from './components/Canvas/GridCanvas';
import { FocusModal } from './components/Viewer/FocusModal';
import { PresetsModal } from './components/Toolbar/PresetsModal';
import { DevicePool } from './components/Toolbar/DevicePool';
import { PollingManager } from './services/pollingManager';
import { LayoutStorage } from './services/layoutStorage';

const pollingManager = new PollingManager();

export const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('MONITOR');
  const [layout, setLayout] = useState<ClassroomLayout>(() => LayoutStorage.getDefaultPreset('aisle'));
  const [focusDevice, setFocusDevice] = useState<StudentDevice | null>(null);
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const [isDevicePoolOpen, setIsDevicePoolOpen] = useState(false);
  const [zoom, setZoom] = useState(0.85);

  const [broadcastConfig, setBroadcastConfig] = useState<BroadcastConfig>({
    active: false,
    multicastIp: '239.255.42.100',
    port: 9000,
    fps: 30,
    bitrateKbps: 5000,
    screenSource: 'primary',
  });

  // 1 FPS Snapshot Polling with AbortController 800ms Circuit Breaker
  useEffect(() => {
    if (mode === 'MONITOR') {
      pollingManager.startPolling(
        () => layout.seats,
        (updated) => {
          setLayout((prev) => ({
            ...prev,
            seats: prev.seats.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
          }));
        },
        1000
      );
    } else {
      pollingManager.stopPolling();
    }

    return () => pollingManager.stopPolling();
  }, [mode, layout.seats]);

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

  const handleToggleBroadcast = () => {
    setBroadcastConfig((prev) => ({ ...prev, active: !prev.active }));
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
    setLayout((prev) => ({
      ...prev,
      seats: prev.seats.filter((s) => s.id !== id),
    }));
  };

  const handleAutoAssign = () => {
    // Sort seats cleanly by hostname
    setLayout((prev) => {
      const sortedSeats = [...prev.seats].sort((a, b) => a.hostname.localeCompare(b.hostname));
      return { ...prev, seats: sortedSeats };
    });
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 overflow-hidden">
      <TopNav
        mode={mode}
        setMode={setMode}
        layout={layout}
        onLayoutChange={setLayout}
        broadcastConfig={broadcastConfig}
        onToggleBroadcast={handleToggleBroadcast}
        onOpenPresets={() => setIsPresetsOpen(true)}
        onOpenDevicePool={() => setIsDevicePoolOpen(true)}
        zoom={zoom}
        setZoom={setZoom}
        onResetView={() => setZoom(0.85)}
      />

      <GridCanvas
        layout={layout}
        mode={mode}
        zoom={zoom}
        onSelectStudent={handleSelectStudent}
        onFocusStudent={setFocusDevice}
        onRefreshAuth={handleRefreshAuth}
        onUnbindSeat={handleUnbindSeat}
      />

      {/* Focus 30FPS WebCodecs Viewer Modal */}
      <FocusModal
        device={focusDevice}
        onClose={() => setFocusDevice(null)}
      />

      {/* Layout Presets Modal */}
      <PresetsModal
        isOpen={isPresetsOpen}
        onClose={() => setIsPresetsOpen(false)}
        onSelectLayout={(newLayout) => {
          setLayout(newLayout);
          LayoutStorage.saveLayout(newLayout);
        }}
      />

      {/* Device Pool Drawer */}
      <DevicePool
        isOpen={isDevicePoolOpen}
        onClose={() => setIsDevicePoolOpen(false)}
        unassignedDevices={[]}
        onAutoAssign={handleAutoAssign}
      />
    </div>
  );
};
