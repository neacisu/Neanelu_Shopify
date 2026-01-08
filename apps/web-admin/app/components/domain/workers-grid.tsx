import { PolarisBadge, PolarisCard } from '../../../components/polaris/index.js';
import { GaugeChart, calculateDynamicMax } from '../charts/GaugeChart.js';

export type WorkerSummary = Readonly<{
  id: string;
  ok: boolean;
  pid: number;
  uptimeSec: number;
  memoryRssBytes: number;
  memoryHeapUsedBytes: number;
  /** Heap total from process.memoryUsage().heapTotal - used for dynamic gauge max */
  memoryHeapTotalBytes?: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  currentJob: Readonly<{
    jobId: string;
    jobName: string;
    startedAtIso: string;
    progressPct: number | null;
  }> | null;
}>;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function WorkersGrid({ workers }: { workers: WorkerSummary[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {workers.map((w) => {
        // F4.5.4: Calculate dynamic max values for gauges
        const { heapMax, rssMax } = calculateDynamicMax({
          heapTotal: w.memoryHeapTotalBytes,
          rss: w.memoryRssBytes,
        });

        return (
          <PolarisCard key={w.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-h4">{w.id}</div>
                <div className="text-caption text-muted">pid {w.pid}</div>
              </div>
              <PolarisBadge tone={w.ok ? 'success' : 'neutral'}>
                {w.ok ? 'Online' : 'Offline'}
              </PolarisBadge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-caption text-muted">Uptime</div>
                <div className="font-mono">{formatDuration(w.uptimeSec)}</div>
              </div>
              <div>
                <div className="text-caption text-muted">Current job</div>
                <div className="font-mono">
                  {w.currentJob
                    ? `${w.currentJob.jobName} (${w.currentJob.jobId})`
                    : w.ok
                      ? 'Idle'
                      : '—'}
                </div>
                {w.currentJob?.progressPct != null ? (
                  <div className="text-caption text-muted">
                    {Math.round(w.currentJob.progressPct)}%
                  </div>
                ) : null}
              </div>
            </div>

            {/* F4.5.4: Circular gauge charts for memory metrics */}
            <div className="mt-4 flex items-center justify-around gap-2">
              <GaugeChart
                value={w.memoryRssBytes}
                max={rssMax}
                size={72}
                label="RSS"
                formatValue={formatBytes}
              />
              <GaugeChart
                value={w.memoryHeapUsedBytes}
                max={heapMax}
                size={72}
                label="Heap"
                formatValue={formatBytes}
              />
              <GaugeChart
                value={w.cpuUserMicros / 1000}
                max={10000} // 10 seconds of CPU time as reference max
                size={72}
                label="CPU"
                formatValue={(v) => `${Math.round(v)} ms`}
              />
            </div>
          </PolarisCard>
        );
      })}
    </div>
  );
}
