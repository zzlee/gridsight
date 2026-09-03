const normalizeTarget = (raw: string) => {
  if (!raw) return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return decoded.replace(/%3A/gi, ':').trim().toUpperCase();
};

const map = new Map<string, string>();
const normalizeTargetOptimized = (raw: string) => {
  if (!raw) return '';
  const cached = map.get(raw);
  if (cached !== undefined) return cached;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const result = decoded.replace(/%3A/gi, ':').trim().toUpperCase();
  if (map.size < 10000) {
    map.set(raw, result);
  }
  return result;
};


const ITERATIONS = 1000000;
const testCases = [
  '00:11:22:33:44:55',
  '00%3A11%3A22%3A33%3A44%3A55',
  ' 00:11:22:33:44:55 ',
  '192.168.1.10',
  'STUDENT-PC-01'
];

let startTime = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  for (const tc of testCases) {
    normalizeTarget(tc);
  }
}
let endTime = process.hrtime.bigint();
console.log(`Unoptimized: ${Number(endTime - startTime) / 1000000} ms`);


startTime = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  for (const tc of testCases) {
    normalizeTargetOptimized(tc);
  }
}
endTime = process.hrtime.bigint();
console.log(`Optimized: ${Number(endTime - startTime) / 1000000} ms`);
