type LatencySample = Readonly<{ tsMs: number; durationMs: number }>;

const WINDOW_MS = 5 * 60_000;
const MAX_SAMPLES = 5_000;

const samples: LatencySample[] = [];

function prune(nowMs: number): void {
  const cutoff = nowMs - WINDOW_MS;
  while (samples.length && samples[0]!.tsMs < cutoff) {
    samples.shift();
  }
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

export function recordHttpLatencySeconds(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return;
  const nowMs = Date.now();
  samples.push({ tsMs: nowMs, durationMs: durationSeconds * 1000 });
  prune(nowMs);
}

export function getHttpLatencySnapshot(): Readonly<{
  windowMs: number;
  sampleCount: number;
  p95Seconds: number;
}> {
  const nowMs = Date.now();
  prune(nowMs);
  const durations = samples.map((s) => s.durationMs);
  const p95Ms = percentile(durations, 0.95);
  return {
    windowMs: WINDOW_MS,
    sampleCount: samples.length,
    p95Seconds: p95Ms / 1000,
  };
}
