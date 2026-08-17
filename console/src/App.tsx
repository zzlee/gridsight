import React, { useEffect, useState } from 'react';
import { ClassroomLayout, StudentDevice, AppMode, BroadcastConfig } from './types';
import { TopNav } from './components/Toolbar/TopNav';
import { GridCanvas } from './components/Canvas/GridCanvas';
import { FocusModal } from './components/Viewer/FocusModal';
import { DeviceSpecsModal } from './components/Viewer/DeviceSpecsModal';
import { PresetsModal } from './components/Toolbar/PresetsModal';
import { DevicePool } from './components/Toolbar/DevicePool';
import { PollingManager } from './services/pollingManager';
import { LayoutStorage } from './services/layoutStorage';

const pollingManager = new PollingManager();

export const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('MONITOR');
  const [layout, setLayout] = useState<ClassroomLayout>(() => LayoutStorage.getDefaultPreset('aisle'));
  const [focusDevice, setFocusDevice] = useState<StudentDevice | null>(null);
  const [specsDevice, setSpecsDevice] = useState<StudentDevice | null>(null);
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

  const [unassignedDevices, setUnassignedDevices] = useState<StudentDevice[]>([]);

  // Fetch discovered devices from backend /api/agents (relative path for Docker & remote access)
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const resp = await fetch('/api/agents');
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
  }, []);

  // 1 FPS Snapshot Polling & Periodic /status Telemetry with Circuit Breaker
  useEffect(() => {
    if (mode === 'MONITOR') {
      pollingManager.startPolling(
        () => layout.seats,
        (updated) => {
          setLayout((prev) => ({
            ...prev,
            seats: prev.seats.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
          }));

          // Keep active modal device state up-to-date
          setFocusDevice((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
          setSpecsDevice((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
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

  const handleToggleBroadcast = async () => {
    const nextActive = !broadcastConfig.active;
    setBroadcastConfig((prev) => ({ ...prev, active: nextActive }));

    try {
      if (nextActive) {
        await fetch('/api/broadcast/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            multicastIp: broadcastConfig.multicastIp,
            port: broadcastConfig.port,
            fps: broadcastConfig.fps,
            bitrateKbps: broadcastConfig.bitrateKbps,
          }),
        });
      } else {
        await fetch('/api/broadcast/stop', { method: 'POST' });
      }
    } catch {
      // Backend not reached, local broadcast toggle state remains
    }
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
    // Assign unassigned devices sequentially into seats
    setLayout((prev) => {
      let seatIdx = 0;
      const updatedSeats = [...prev.seats];
      unassignedDevices.forEach((dev) => {
        while (seatIdx < updatedSeats.length && updatedSeats[seatIdx].status === 'online') {
          seatIdx++;
        }
        if (seatIdx < updatedSeats.length) {
          updatedSeats[seatIdx] = {
            ...updatedSeats[seatIdx],
            id: dev.id,
            hostname: dev.hostname,
            ip: dev.ip,
            mac: dev.mac,
            token: dev.token,
            status: 'online',
          };
          seatIdx++;
        }
      });
      setUnassignedDevices([]);
      return { ...prev, seats: updatedSeats };
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
        onOpenSpecs={setSpecsDevice}
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
        unassignedDevices={unassignedDevices}
        onAutoAssign={handleAutoAssign}
      />
    </div>
  );
};
