import { useState, useEffect, useRef, MutableRefObject } from 'react';
import { ClassroomLayout, StudentDevice, AppMode } from '../types';
import { PollingManager, TrafficStats } from '../services/pollingManager';
import { LayoutStorage } from '../services/layoutStorage';
import { AuthService } from '../services/authService';

interface UseAgentDiscoveryProps {
  mode: AppMode;
  alertsEnabled: boolean;
  offTaskKeywords: string[];
  isOffTaskMatch: (title?: string, kws?: string[]) => boolean;
  setOffTaskKeywords?: (kws: string[]) => void;
  pollingManager: PollingManager;
  visibleDeviceIdsRef: MutableRefObject<Set<string>>;
  setFocusDevice: React.Dispatch<React.SetStateAction<StudentDevice | null>>;
  setSpecsDevice: React.Dispatch<React.SetStateAction<StudentDevice | null>>;
}

export function useAgentDiscovery({
  mode,
  alertsEnabled,
  offTaskKeywords,
  isOffTaskMatch,
  setOffTaskKeywords,
  pollingManager,
  visibleDeviceIdsRef,
  setFocusDevice,
  setSpecsDevice,
}: UseAgentDiscoveryProps) {
  const [isLocked, setIsLocked] = useState(true);
  const [layout, setLayout] = useState<ClassroomLayout>(() => LayoutStorage.getLocalCachedLayout());
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const [trafficStats, setTrafficStats] = useState<TrafficStats | null>(null);
  const [unassignedDevices, setUnassignedDevices] = useState<StudentDevice[]>([]);

  // Load layout from server SEATS_FILE on startup
  useEffect(() => {
    LayoutStorage.fetchServerLayout().then((srvLayout) => {
      if (srvLayout) {
        setLayout(srvLayout);
        if (Array.isArray(srvLayout.offTaskKeywords) && srvLayout.offTaskKeywords.length > 0) {
          setOffTaskKeywords?.(srvLayout.offTaskKeywords);
        }
      }
    });
  }, [setOffTaskKeywords]);

  // Check auth session on startup
  useEffect(() => {
    AuthService.verify().then((authed) => {
      setIsLocked(!authed);
    });
  }, []);

  // Fetch discovered devices from backend /api/agents
  useEffect(() => {
    if (isLocked) return;

    const fetchAgents = async () => {
      try {
        const resp = await AuthService.fetchWithAuth('/api/agents');
        if (resp.ok) {
          const data = await resp.json();
          if (data.agents && Array.isArray(data.agents)) {
            const discovered: StudentDevice[] = data.agents.map((a: any) => {
              const activeWindow = a.activeWindow || a.specs?.active_window || a.window_title || '桌面 (Desktop)';
              const isOff = alertsEnabled && isOffTaskMatch(activeWindow, offTaskKeywords);
              return {
                id: a.mac || `dev-${a.ip.replace(/\./g, '-')}`,
                hostname: a.hostname,
                ip: a.ip,
                mac: a.mac,
                status: 'online',
                token: a.token,
                activeWindow,
                isOffTask: isOff,
                specs: a.specs,
                gridX: 0,
                gridY: 0,
              };
            });

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
                  const activeWindow = dev.activeWindow || seat.activeWindow || '桌面 (Desktop)';
                  const isOff = alertsEnabled && isOffTaskMatch(activeWindow, offTaskKeywords);
                  return {
                    ...seat,
                    ip: dev.ip,
                    hostname: dev.hostname || seat.hostname,
                    token: dev.token || seat.token,
                    mac: dev.mac || seat.mac,
                    activeWindow,
                    isOffTask: isOff,
                    specs: dev.specs || seat.specs,
                    status: 'online' as const,
                  };
                } else {
                  // Device is no longer broadcasting beacons -> mark offline
                  return {
                    ...seat,
                    status: 'offline' as const,
                    isOffTask: false,
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
  }, [isLocked, alertsEnabled, offTaskKeywords, isOffTaskMatch]);

  // 1 FPS Snapshot Polling & Periodic /status Telemetry
  useEffect(() => {
    if (mode === 'MONITOR' && !isLocked) {
      pollingManager.startPolling(
        () => layoutRef.current.seats,
        (updated) => {
          setLayout((prev) => ({
            ...prev,
            seats: prev.seats.map((s) => {
              if (s.id !== updated.id) return s;
              const activeWindow = updated.activeWindow || s.activeWindow || '桌面 (Desktop)';
              const isOff = alertsEnabled && isOffTaskMatch(activeWindow, offTaskKeywords);
              return { ...s, ...updated, activeWindow, isOffTask: isOff };
            }),
          }));

          // Keep active modal device state up-to-date
          setFocusDevice((prev) => {
            if (!prev || prev.id !== updated.id) return prev;
            const activeWindow = updated.activeWindow || prev.activeWindow || '桌面 (Desktop)';
            const isOff = alertsEnabled && isOffTaskMatch(activeWindow, offTaskKeywords);
            return { ...prev, ...updated, activeWindow, isOffTask: isOff };
          });
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
  }, [mode, isLocked, alertsEnabled, offTaskKeywords, isOffTaskMatch, pollingManager, visibleDeviceIdsRef, setFocusDevice, setSpecsDevice]);

  return {
    isLocked,
    setIsLocked,
    layout,
    setLayout,
    trafficStats,
    unassignedDevices,
    setUnassignedDevices,
  };
}
