import { performance } from 'perf_hooks';

// Replicate snapshotCache, SNAPSHOT_CACHE_MAX_KEYS, SNAPSHOT_CACHE_TTL_MS, and pruneSnapshotCache logic from server.ts

const SNAPSHOT_CACHE_MAX_KEYS = 256;
const SNAPSHOT_CACHE_TTL_MS = 30_000;

function runBaselinePrune(cache: Map<string, { buffer: Buffer; timestamp: number }>, now = Date.now()) {
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > SNAPSHOT_CACHE_TTL_MS) cache.delete(key);
  }
  while (cache.size > SNAPSHOT_CACHE_MAX_KEYS) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function runOptimizedPrune(cache: Map<string, { buffer: Buffer; timestamp: number }>, now = Date.now()) {
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > SNAPSHOT_CACHE_TTL_MS) cache.delete(key);
  }
  if (cache.size > SNAPSHOT_CACHE_MAX_KEYS) {
    for (const [key] of cache) {
      cache.delete(key);
      if (cache.size <= SNAPSHOT_CACHE_MAX_KEYS) break;
    }
  }
}

function createTestCache(numEntries: number) {
  const cache = new Map<string, { buffer: Buffer; timestamp: number }>();
  const dummyBuffer = Buffer.alloc(10);
  const now = Date.now();
  for (let i = 0; i < numEntries; i++) {
    cache.set(`key_${i}`, { buffer: dummyBuffer, timestamp: now });
  }
  return cache;
}

function benchmark() {
  const INITIAL_SIZE = 1256; // 1000 items over SNAPSHOT_CACHE_MAX_KEYS (256)
  const ITERATIONS = 10000;

  // Warmup
  for (let i = 0; i < 100; i++) {
    runBaselinePrune(createTestCache(INITIAL_SIZE));
    runOptimizedPrune(createTestCache(INITIAL_SIZE));
  }

  // Baseline Benchmark
  const baselineStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const cache = createTestCache(INITIAL_SIZE);
    runBaselinePrune(cache);
  }
  const baselineDuration = performance.now() - baselineStart;

  // Optimized Benchmark
  const optStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const cache = createTestCache(INITIAL_SIZE);
    runOptimizedPrune(cache);
  }
  const optDuration = performance.now() - optStart;

  const speedup = (baselineDuration / optDuration).toFixed(2);
  const pct = (((baselineDuration - optDuration) / baselineDuration) * 100).toFixed(1);

  console.log(`[Benchmark Results] Iterations: ${ITERATIONS}, Oversized entries per run: 1000`);
  console.log(`  - Baseline (Map.keys().next()): ${baselineDuration.toFixed(2)} ms`);
  console.log(`  - Optimized (for...of eviction loop): ${optDuration.toFixed(2)} ms`);
  console.log(`  - Performance Improvement: ${speedup}x faster (${pct}% time reduction)`);
}

benchmark();
