import { StudentDevice } from '../types';
import { AbortableRequestCircuitBreaker } from '../utils/circuitBreaker';

export class PollingManager {
  private circuitBreaker = new AbortableRequestCircuitBreaker(800); // 800ms circuit breaker timeout
  private intervalId: number | null = null;
  private isPolling = false;
  private pollCount = 0;
  private activeThumbUrls = new Map<string, string>(); // deviceId -> blob URL

  startPolling(
    getDevices: () => StudentDevice[],
    onUpdateDevice: (device: Partial<StudentDevice> & { id: string }) => void,
    intervalMs = 1000
  ) {
    if (this.intervalId) return;

    this.intervalId = window.setInterval(async () => {
      if (this.isPolling) return;
      this.isPolling = true;
      this.pollCount++;

      const devices = getDevices();
      const onlineOrDegraded = devices.filter((d) => d.ip && d.status !== 'offline');
      const shouldPollStatus = this.pollCount % 5 === 0; // Poll hardware status every 5 seconds

      // Batch poll in parallel batches of 10 to protect teacher client socket pool
      const batchSize = 10;
      for (let i = 0; i < onlineOrDegraded.length; i += batchSize) {
        const batch = onlineOrDegraded.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map(async (device) => {
            const start = performance.now();
            try {
              const url = `http://${device.ip}:8080/snapshot?t=${Date.now()}`;
              const headers: Record<string, string> = device.token ? { 'X-Auth-Token': device.token } : {};
              
              const resp = await this.circuitBreaker.fetchWithTimeout(url, { headers });

              if (resp.ok) {
                const blob = await resp.blob();
                const latency = Math.round(performance.now() - start);
                const thumbUrl = URL.createObjectURL(blob);

                // Revoke previously created blob URL for this device to prevent memory leak
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
                  status: latency > 500 ? 'degraded' : 'online',
                });
              } else {
                onUpdateDevice({
                  id: device.id,
                  status: 'degraded',
                  latencyMs: 800,
                });
              }

              // Periodic /status polling for CPU/RAM/Disk hardware specs
              if (shouldPollStatus || !device.specs) {
                try {
                  const statusUrl = `http://${device.ip}:8080/status`;
                  const statusResp = await this.circuitBreaker.fetchWithTimeout(statusUrl, { headers });
                  if (statusResp.ok) {
                    const specs = await statusResp.json();
                    onUpdateDevice({
                      id: device.id,
                      specs,
                    });
                  }
                } catch {
                  // Non-fatal telemetry poll error
                }
              }
            } catch (err) {
              onUpdateDevice({
                id: device.id,
                status: 'offline',
                latencyMs: 999,
              });
            }
          })
        );
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
