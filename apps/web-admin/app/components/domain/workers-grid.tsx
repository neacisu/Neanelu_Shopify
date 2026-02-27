import { useRef } from 'react';
import { InfoTooltip } from '../ui/info-tooltip';
import { GaugeChart, calculateDynamicMax } from '../charts/GaugeChart.js';
import { getWorkerDisplayInfo, type WorkerDisplayInfo } from '../../utils/worker-display';

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

const STAGGER_MS = 50;
const STAGGER_CAP = 5;
const ENTER_DURATION_MS = 300;

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

function WorkerCard({
  worker: w,
  index,
  display,
}: {
  worker: WorkerSummary;
  index: number;
  display: WorkerDisplayInfo;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const { heapMax, rssMax } = calculateDynamicMax({
    heapTotal: w.memoryHeapTotalBytes,
    rss: w.memoryRssBytes,
  });
  const isOnline = w.ok;
  const isBusy = w.currentJob != null;

  return (
    <article
      ref={cardRef}
      role="listitem"
      data-hover-lift
      className="group relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[var(--shadow-sm)]
        transition-all duration-300 ease-out
        hover:-translate-y-0.5 hover:border-slate-300/80 hover:shadow-[var(--shadow-md)]
        focus-within:ring-2 focus-within:ring-[rgb(var(--color-ring))]/40 focus-within:ring-offset-2
        dark:border-slate-700/80 dark:bg-slate-800/95 dark:hover:border-slate-600/80"
      style={{
        animation: `workerCardEnter ${ENTER_DURATION_MS}ms ease-out both`,
        animationDelay: `${Math.min(index, STAGGER_CAP) * STAGGER_MS}ms`,
      }}
    >
      {/* Accent bar left: green online, amber when busy, slate offline */}
      <div
        className={`absolute left-0 top-0 h-full w-1 shrink-0 ${
          isOnline
            ? isBusy
              ? 'bg-amber-500 motion-safe:animate-[workerBusyShimmer_2s_ease-in-out_infinite]'
              : 'bg-green-500'
            : 'bg-slate-300 dark:bg-slate-600'
        }`}
        aria-hidden
      />

      <div className="flex flex-col gap-4 p-4 pl-5">
        {/* Header: nume prietenos RO + tooltip, status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3
                className="truncate text-base font-semibold text-slate-800 dark:text-slate-100"
                title={display.labelRo}
              >
                {display.labelRo}
              </h3>
              <InfoTooltip
                title={display.labelRo}
                side="bottom"
                maxWidth={420}
                boundaryRef={cardRef}
              >
                {display.tooltip}
              </InfoTooltip>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              PID {w.pid}
              <InfoTooltip
                title="Identificator proces"
                side="bottom"
                maxWidth={300}
                boundaryRef={cardRef}
              >
                Numărul unic al procesului în sistem. Folosit pentru monitorizare tehnică.
              </InfoTooltip>
              <span className="ml-1.5 text-slate-400 dark:text-slate-500" title={w.id}>
                · {w.id}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                isOnline
                  ? 'bg-green-50 text-green-800 ring-1 ring-green-200/80 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-700/60'
                  : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-700/80 dark:text-slate-400 dark:ring-slate-600/60'
              }`}
              aria-label={isOnline ? 'Activ' : 'Inactiv'}
            >
              <span
                className={`size-2 rounded-full ${
                  isOnline
                    ? 'bg-green-500 motion-safe:animate-[workerOnlinePulse_2s_ease-in-out_infinite]'
                    : 'bg-slate-400 dark:bg-slate-500'
                }`}
                aria-hidden
              />
              {isOnline ? 'Activ' : 'Inactiv'}
            </span>
          </div>
        </div>

        {/* Uptime */}
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            Timp activ:
            <InfoTooltip
              title="Timp de funcționare"
              side="bottom"
              maxWidth={320}
              boundaryRef={cardRef}
            >
              De cât timp rulează acest worker fără întrerupere. Un timp mare indică stabilitate.
            </InfoTooltip>
          </span>
          <span className="font-mono font-medium tabular-nums">{formatDuration(w.uptimeSec)}</span>
        </div>

        {/* Current job / Idle */}
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700/60 dark:bg-slate-800/50">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Activitate
            <InfoTooltip
              title="Activitate curentă"
              side="bottom"
              maxWidth={340}
              boundaryRef={cardRef}
            >
              Job-ul pe care îl execută acum worker-ul. Dacă e „Liber", worker-ul așteaptă sarcini
              noi.
            </InfoTooltip>
          </p>
          {w.currentJob ? (
            <div className="mt-1.5 space-y-1.5">
              <p
                className="truncate text-sm font-medium text-slate-800 dark:text-slate-200"
                title={w.currentJob.jobName}
              >
                {w.currentJob.jobName}
              </p>
              <p
                className="font-mono text-xs text-slate-500 dark:text-slate-400"
                title={w.currentJob.jobId}
              >
                {w.currentJob.jobId}
              </p>
              {w.currentJob.progressPct != null ? (
                <div
                  className="pt-1"
                  role="progressbar"
                  aria-valuenow={Math.round(w.currentJob.progressPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Progres ${Math.round(w.currentJob.progressPct)}%`}
                >
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-600">
                    <div
                      className="h-full rounded-full bg-amber-500 motion-safe:transition-[width_0.5s_ease-out]"
                      style={{ width: `${Math.min(100, Math.max(0, w.currentJob.progressPct))}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {Math.round(w.currentJob.progressPct)}%
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-1.5 text-sm italic text-slate-500 dark:text-slate-400">
              {isOnline ? 'Liber' : '—'}
            </p>
          )}
        </div>

        {/* Gauges */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Resurse
            <InfoTooltip
              title="Utilizare resurse"
              side="bottom"
              maxWidth={360}
              boundaryRef={cardRef}
            >
              Câtă memorie și putere de calcul folosește worker-ul. Valorile ridicate pot indica
              încărcare mare; valorile scăzute înseamnă că worker-ul are spațiu de lucru.
            </InfoTooltip>
          </p>
          <div className="flex items-end justify-around gap-2 rounded-lg bg-slate-50/50 p-3 dark:bg-slate-800/50">
            <GaugeChart
              value={w.memoryRssBytes}
              max={rssMax}
              size={64}
              label="RSS"
              formatValue={formatBytes}
              ariaLabel={`Memorie totală ${formatBytes(w.memoryRssBytes)}`}
            />
            <GaugeChart
              value={w.memoryHeapUsedBytes}
              max={heapMax}
              size={64}
              label="Heap"
              formatValue={formatBytes}
              ariaLabel={`Memorie aplicație ${formatBytes(w.memoryHeapUsedBytes)}`}
            />
            <GaugeChart
              value={w.cpuUserMicros / 1000}
              max={10000}
              size={64}
              label="CPU"
              formatValue={(v) => `${Math.round(v)} ms`}
              ariaLabel={`Procesor ${Math.round(w.cpuUserMicros / 1000)} ms`}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export function WorkersGrid({ workers }: { workers: WorkerSummary[] }) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      role="list"
      aria-label="Lista workeri"
    >
      {workers.map((w, index) => (
        <WorkerCard key={w.id} worker={w} index={index} display={getWorkerDisplayInfo(w.id)} />
      ))}
    </div>
  );
}
