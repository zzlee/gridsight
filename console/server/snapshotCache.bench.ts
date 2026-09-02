import { performance } from 'perf_hooks';

const SNAPSHOT_CACHE_MAX_KEYS = 256;

// Implementation 1: Original while loop with .keys().next()
function pruneOriginal(map: Map<string, { buffer: Buffer; timestamp: number }>) {
  while (map.size > SNAPSHOT_CACHE_MAX_KEYS) {
    const oldestKey = map.keys().next().value as string | undefined;
    if (!oldestKey) break;
    map.delete(oldestKey);
  }
}

// Implementation 2: Single iterator loop
function pruneOptimized(map: Map<string, { buffer: Buffer; timestamp: number }>) {
  if (map.size > SNAPSHOT_CACHE_MAX_KEYS) {
    for (const key of map.keys()) {
      map.delete(key);
      if (map.size <= SNAPSHOT_CACHE_MAX_KEYS) break;
    }
  }
}

function runBenchmark() {
  const dummyBuffer = Buffer.alloc(10);
  const iterations = 50_000;
  const overflowSize = 512; // Insert 512 entries, then prune down to 256 (256 evictions per iteration)

  // Warmup
  {
    const map = new Map<string, { buffer: Buffer; timestamp: number }>();
    for (let i = 0; i < overflowSize; i++) map.set(`key_${i}`, { buffer: dummyBuffer, timestamp: Date.now() });
    pruneOriginal(map);
    pruneOptimized(map);
  }

  // Measure Original
  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    const map = new Map<string, { buffer: Buffer; timestamp: number }>();
    for (let k = 0; k < overflowSize; k++) {
      map.set(`key_${k}`, { buffer: dummyBuffer, timestamp: Date.now() });
    }
    pruneOriginal(map);
  }
  const durationOriginal = performance.now() - startOriginal;

  // Measure Optimized
  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    const map = new Map<string, { buffer: Buffer; timestamp: number }>();
    for (let k = 0; k < overflowSize; k++) {
      map.set(`key_${k}`, { buffer: dummyBuffer, timestamp: Date.now() });
    }
    pruneOptimized(map);
  }
  const durationOptimized = performance.now() - startOptimized;

  console.log(`=== Snapshot Cache Eviction Benchmark (${iterations} runs, evicting ${overflowSize - SNAPSHOT_CACHE_MAX_KEYS} keys per run) ===`);
  console.log(`Original duration:  ${durationOriginal.toFixed(2)} ms`);
  console.log(`Optimized duration: ${durationOptimized.toFixed(2)} ms`);
  const speedup = ((durationOriginal - durationOptimized) / durationOriginal) * 100;
  console.log(`Speedup:            ${speedup.toFixed(2)}%`);
}

runBenchmark();
