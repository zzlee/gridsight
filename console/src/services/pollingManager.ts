import { StudentDevice } from '../types';
import { AbortableRequestCircuitBreaker } from '../utils/circuitBreaker';
import { AuthService } from './authService';

export interface TrafficStats {
  bytesPerSec: number;
  totalBytes: number;
  polledCount: number;
  onlineCount: number;
  avgLatencyMs: number;
}

export class PollingManager {
  private circuitBreaker = new AbortableRequestCircuitBreaker(1200);
  private intervalId: number | null = null;
  private isPolling = false;
  private activeThumbUrls = new Map<string, string>(); // deviceId -> blob URL
  private totalBytesTransferred = 0;

  startPolling(
    getDevices: () => StudentDevice[],
    onUpdateDevice: (device: Partial<StudentDevice> & { id: string }) => void,
    intervalMs = 1000,
    getVisibleDeviceIds?: () => Set<string> | null,
    onTrafficStats?: (stats: TrafficStats) => void
  ) {
    if (this.intervalId) return;

    let lastTickTime = performance.now();

    this.intervalId = window.setInterval(async () => {
      if (this.isPolling) return;
      this.isPolling = true;

      const tickStart = performance.now();
      const timeDeltaSec = Math.max(0.1, (tickStart - lastTickTime) / 1000);
      lastTickTime = tickStart;

      const devices = getDevices();
      const onlineDevices = devices.filter((d) => d.ip && d.status !== 'offline');

      // Viewport-aware culling: ONLY poll devices currently visible in the teacher's viewport
      const visibleIds = getVisibleDeviceIds ? getVisibleDeviceIds() : null;
      const targetDevices = visibleIds && visibleIds.size > 0
        ? onlineDevices.filter((d) => visibleIds.has(d.id) || (d.mac && visibleIds.has(d.mac)))
        : onlineDevices;

      let tickBytes = 0;
      let tickLatencies: number[] = [];

      // Batch poll visible devices in parallel chunks of 10
      const batchSize = 10;
      for (let i = 0; i < targetDevices.length; i += batchSize) {
        const batch = targetDevices.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map(async (device) => {
            const start = performance.now();
            try {
              // 1. Primary: Fetch outbound cached snapshot from Teacher Console Server
              const serverSnapshotUrl = `/api/snapshot/${encodeURIComponent(device.mac || device.ip)}?t=${Date.now()}`;
              const teacherToken = AuthService.getToken();
              let resp = await this.circuitBreaker.fetchWithTimeout(serverSnapshotUrl, {
                headers: teacherToken ? { Authorization: `Bearer ${teacherToken}` } : {},
              });

              // 2. Fallback: If not cached on server yet, try direct student port 8080
              if (!resp.ok && device.ip) {
                try {
                  const directUrl = `http://${device.ip}:8080/snapshot?t=${Date.now()}`;
                  resp = await this.circuitBreaker.fetchWithTimeout(directUrl, {
                    headers: device.token ? { 'X-Auth-Token': device.token } : {},
                  });
                } catch {
                  // Direct connection blocked by firewall, wait for outbound push
                }
              }

              if (resp && resp.ok) {
                const blob = await resp.blob();
                const latency = Math.round(performance.now() - start);
                const thumbUrl = URL.createObjectURL(blob);

                tickBytes += blob.size;
                this.totalBytesTransferred += blob.size;
                tickLatencies.push(latency);

                // Revoke previously created blob URL
                const prevUrl = this.activeThumbUrls.get(device.id);
                if (prevUrl) {
                  URL.revokeObjectURL(prevUrl);
                }
                this.activeThumbUrls.set(device.id, thumbUrl);

                onUpdateDevice({
                  id: device.id,
                  thumbnailUrl: thumbUrl,
                  latencyMs: latency,
                  lastSeen: Date.now(),
                  status: 'online',
                });
              }
            } catch {
              // Do not toggle status to offline here; online lifecycle is governed by UDP discovery beacons
            }
          })
        );
      }

      if (onTrafficStats) {
        const avgLat = tickLatencies.length > 0
          ? Math.round(tickLatencies.reduce((a, b) => a + b, 0) / tickLatencies.length)
          : 0;

        onTrafficStats({
          bytesPerSec: Math.round(tickBytes / timeDeltaSec),
          totalBytes: this.totalBytesTransferred,
          polledCount: targetDevices.length,
          onlineCount: onlineDevices.length,
          avgLatencyMs: avgLat,
        });
      }

      this.isPolling = false;
    }, intervalMs);
  }

  stopPolling() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Clean up all allocated blob URLs on stop
    this.activeThumbUrls.forEach((url) => URL.revokeObjectURL(url));
    this.activeThumbUrls.clear();
  }
}
