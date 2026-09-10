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
  private circuitBreaker = new AbortableRequestCircuitBreaker(1500);
  private intervalId: number | null = null;
  private isPolling = false;
  private activeThumbUrls = new Map<string, string>(); // deviceId -> blob/data URL
  private lastSnapshotTimestamps = new Map<string, number>(); // deviceId -> last server snapshot timestamp
  private totalBytesTransferred = 0;
  private useBatchApi = true; // Set to false if backend returns 404

  startPolling(
    getDevices: () => StudentDevice[],
    onUpdateDevice: ((device: Partial<StudentDevice> & { id: string }) => void) | null,
    intervalMs = 1000,
    getVisibleDeviceIds?: () => Set<string> | null,
    onTrafficStats?: (stats: TrafficStats) => void,
    onBatchUpdate?: (devices: (Partial<StudentDevice> & { id: string })[]) => void
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
      const batchedUpdates: (Partial<StudentDevice> & { id: string })[] = [];

      if (this.useBatchApi && targetDevices.length > 0) {
        // High-Performance Batch Polling Pipeline
        try {
          const teacherToken = AuthService.getToken();
          const requests = targetDevices.map((d) => ({
            id: d.mac || d.ip,
            since: this.lastSnapshotTimestamps.get(d.id) || 0,
          }));

          const reqStart = performance.now();
          const resp = await this.circuitBreaker.fetchWithTimeout('/api/snapshots/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(teacherToken ? { Authorization: `Bearer ${teacherToken}` } : {}),
            },
            body: JSON.stringify({ requests }),
          });

          if (resp && resp.ok) {
            const json = await resp.json();
            const latency = Math.round(performance.now() - reqStart);
            tickLatencies.push(latency);

            // Index targets for fast lookups
            const targetMap = new Map<string, StudentDevice>();
            targetDevices.forEach((d) => {
              if (d.mac) {
                targetMap.set(d.mac.toUpperCase().replace(/[:-]/g, ''), d);
                targetMap.set(d.mac.toLowerCase(), d);
              }
              if (d.ip) targetMap.set(d.ip, d);
              targetMap.set(d.id, d);
            });

            const results: Array<{
              id: string;
              notModified: boolean;
              timestamp?: number;
              data?: string;
              activeWindow?: string;
              status?: 'online' | 'offline';
            }> = json.results || [];

            for (const item of results) {
              const normKey = item.id.replace(/[:-]/g, '').toUpperCase();
              const device = targetMap.get(normKey) || targetMap.get(item.id);
              if (!device) continue;

              const update: Partial<StudentDevice> & { id: string } = {
                id: device.id,
                latencyMs: latency,
                lastSeen: Date.now(),
                status: item.status || 'online',
              };

              if (item.activeWindow) {
                update.activeWindow = item.activeWindow;
              }

              if (!item.notModified && item.data) {
                const b64Bytes = Math.round(item.data.length * 0.75);
                tickBytes += b64Bytes;
                this.totalBytesTransferred += b64Bytes;

                const prevUrl = this.activeThumbUrls.get(device.id);
                if (prevUrl && prevUrl.startsWith('blob:')) {
                  URL.revokeObjectURL(prevUrl);
                }

                const thumbUrl = `data:image/jpeg;base64,${item.data}`;
                this.activeThumbUrls.set(device.id, thumbUrl);
                if (item.timestamp) {
                  this.lastSnapshotTimestamps.set(device.id, item.timestamp);
                }
                update.thumbnailUrl = thumbUrl;
              }

              batchedUpdates.push(update);
            }
          } else if (resp && resp.status === 404) {
            // Server doesn't support batch API, fallback permanently
            this.useBatchApi = false;
          }
        } catch {
          // Network or timeout, fallback to next tick or graceful skip
        }
      }

      // Fallback: Individual requests if batch API is disabled or returned 404
      if (!this.useBatchApi && targetDevices.length > 0) {
        const batchSize = 10;
        for (let i = 0; i < targetDevices.length; i += batchSize) {
          const batch = targetDevices.slice(i, i + batchSize);
          await Promise.allSettled(
            batch.map(async (device) => {
              const start = performance.now();
              try {
                const serverSnapshotUrl = `/api/snapshot/${encodeURIComponent(device.mac || device.ip)}?t=${Date.now()}`;
                const teacherToken = AuthService.getToken();
                const resp = await this.circuitBreaker.fetchWithTimeout(serverSnapshotUrl, {
                  headers: teacherToken ? { Authorization: `Bearer ${teacherToken}` } : {},
                });

                if (resp && resp.ok) {
                  const blob = await resp.blob();
                  const latency = Math.round(performance.now() - start);
                  const thumbUrl = URL.createObjectURL(blob);

                  tickBytes += blob.size;
                  this.totalBytesTransferred += blob.size;
                  tickLatencies.push(latency);

                  const prevUrl = this.activeThumbUrls.get(device.id);
                  if (prevUrl && prevUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(prevUrl);
                  }
                  this.activeThumbUrls.set(device.id, thumbUrl);

                  batchedUpdates.push({
                    id: device.id,
                    thumbnailUrl: thumbUrl,
                    latencyMs: latency,
                    lastSeen: Date.now(),
                    status: 'online',
                  });
                }
              } catch {}
            })
          );
        }
      }

      // Dispatch batched updates in a single state turn
      if (batchedUpdates.length > 0) {
        if (onBatchUpdate) {
          onBatchUpdate(batchedUpdates);
        } else if (onUpdateDevice) {
          batchedUpdates.forEach((up) => onUpdateDevice(up));
        }
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
    this.activeThumbUrls.forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    this.activeThumbUrls.clear();
    this.lastSnapshotTimestamps.clear();
  }
}
