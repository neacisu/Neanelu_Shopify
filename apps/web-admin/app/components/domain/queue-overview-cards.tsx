/**
 * Carduri state-of-the-art pentru fiecare coadă în tab-ul Prezentare (Queues).
 * Înlocuiește tabelul cu un grid de carduri: etichete RO, tooltip-uri detaliate, statistici, butoane de control per coadă.
 */

import type React from 'react';
import { useCallback, useRef } from 'react';
import { useCountUp } from '../../hooks/useCountUp';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { InfoTooltip } from '../ui/info-tooltip';
import { Button } from '../ui/button';
import { getQueueDisplayInfo, type QueueDisplayInfo } from '../../utils/queue-display';

function QueueStatCountUp({ value }: { value: number }) {
  return <>{useCountUp(value, { format: (n) => String(Math.round(n)) })}</>;
}

export type QueueSummary = Readonly<{
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}>;

const STAGGER_MS = 45;
const STAGGER_CAP = 6;
const ENTER_DURATION_MS = 280;

export type QueueOverviewCardProps = Readonly<{
  queue: QueueSummary;
  display: QueueDisplayInfo;
  index: number;
  isSelected: boolean;
  mutating: boolean;
  onSelect: () => void;
  onPause: (queueName: string) => void;
  onResume: (queueName: string) => void;
  onCleanFailed: (queueName: string) => void;
}>;

export function QueueOverviewCard({
  queue,
  display,
  index,
  isSelected,
  mutating,
  onSelect,
  onPause,
  onResume,
  onCleanFailed,
}: QueueOverviewCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const [revealRef, isVisible] = useScrollReveal<HTMLElement>({ rootMargin: '0px 0px -24px 0px' });
  const setRefs = useCallback(
    (el: HTMLElement | null) => {
      (cardRef as React.MutableRefObject<HTMLElement | null>).current = el;
      (revealRef as React.MutableRefObject<HTMLElement | null>).current = el;
    },
    [revealRef]
  );
  const hasFailed = queue.failed > 0;
  const hasActive = queue.active > 0;
  const accent = hasFailed ? 'amber' : hasActive ? 'blue' : 'slate';

  return (
    <article
      ref={setRefs}
      role="listitem"
      data-hover-lift
      className={`group relative overflow-hidden rounded-xl border bg-white/80 backdrop-blur-sm shadow-[var(--shadow-sm)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:ring-offset-2 dark:bg-slate-900/80 dark:focus-within:ring-blue-400/50 dark:focus-within:ring-offset-slate-900 ${
        isSelected
          ? 'border-blue-400/80 ring-2 ring-blue-400/20 shadow-[var(--shadow-md)] dark:border-blue-500/60 dark:ring-blue-500/30'
          : 'border-slate-200/90 hover:border-slate-300/80 dark:border-slate-700/80 dark:hover:border-slate-600/80'
      }`}
      style={{
        animation: isVisible ? `queueCardEnter ${ENTER_DURATION_MS}ms ease-out both` : 'none',
        animationDelay: isVisible ? `${Math.min(index, STAGGER_CAP) * STAGGER_MS}ms` : '0ms',
      }}
    >
      {/* Accent bar: amber when has failed, blue when active, slate when idle */}
      <div
        className={`absolute left-0 top-0 h-full w-1 shrink-0 ${
          accent === 'amber'
            ? 'bg-amber-500'
            : accent === 'blue'
              ? 'bg-blue-500'
              : 'bg-slate-300 dark:bg-slate-600'
        }`}
        aria-hidden
      />

      <div className="flex flex-col gap-4 p-4 pl-5">
        {/* Header: nume prietenos + tooltip */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onSelect}
                className="focus-ring truncate text-left text-base font-semibold text-slate-800 transition-colors hover:text-blue-600 focus:outline-none dark:text-slate-100 dark:hover:text-blue-400"
                title={display.labelRo}
              >
                {display.labelRo}
              </button>
              <InfoTooltip
                title={display.labelRo}
                side="bottom"
                maxWidth={420}
                boundaryRef={cardRef}
              >
                {display.tooltip}
              </InfoTooltip>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" title="Nume intern">
              {queue.name}
            </p>
          </div>
          {isSelected ? (
            <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200/80 dark:bg-blue-900/40 dark:text-blue-300 dark:ring-blue-700/60">
              Selectată
            </span>
          ) : null}
        </div>

        {/* Statistici: grid compact */}
        <div className="grid grid-cols-5 gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700/60 dark:bg-slate-800/50">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              În așteptare
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              <QueueStatCountUp value={queue.waiting} />
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Active
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              <QueueStatCountUp value={queue.active} />
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Amânate
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              <QueueStatCountUp value={queue.delayed} />
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Finalizate
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              <QueueStatCountUp value={queue.completed} />
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Eșuate
            </p>
            <p
              className={`font-mono text-sm font-semibold tabular-nums ${
                queue.failed > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-800 dark:text-slate-100'
              }`}
            >
              <QueueStatCountUp value={queue.failed} />
            </p>
          </div>
        </div>

        {/* Butoane pe un rând, (i) sub fiecare buton */}
        <div className="flex flex-nowrap items-end gap-3">
          <div className="flex flex-col items-center gap-0.5">
            <Button
              variant="neutral"
              size="sm"
              disabled={mutating}
              onClick={() => onPause(queue.name)}
              className="text-xs"
            >
              Pauză
            </Button>
            <InfoTooltip title="Pauză" side="bottom" maxWidth={320} boundaryRef={cardRef}>
              Oprește temporar această coadă: job-urile noi nu mai sunt luate în lucru; cele deja în
              execuție se termină. Poți reporni cu „Reia".
            </InfoTooltip>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <Button
              variant="positive"
              size="sm"
              disabled={mutating}
              onClick={() => onResume(queue.name)}
              className="text-xs"
            >
              Reia
            </Button>
            <InfoTooltip title="Reia" side="bottom" maxWidth={280} boundaryRef={cardRef}>
              Repornește coada după ce ai folosit „Pauză". Nu are efect dacă coada nu e pusă pe
              pauză.
            </InfoTooltip>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <Button
              variant="destructive"
              size="sm"
              disabled={mutating}
              onClick={() => onCleanFailed(queue.name)}
              className="text-xs"
            >
              Șterge eșecuri
            </Button>
            <InfoTooltip
              title="Șterge job-urile eșuate"
              side="bottom"
              maxWidth={340}
              boundaryRef={cardRef}
            >
              Șterge din coadă toate job-urile cu status „failed". Dispar definitiv. Pentru a
              relansa anumite job-uri eșuate, folosește tab-ul „Job-uri", selectează-le și apasă
              „Retry Selected".
            </InfoTooltip>
          </div>
        </div>
      </div>
    </article>
  );
}

export type QueuesOverviewGridProps = Readonly<{
  queues: QueueSummary[];
  selectedQueue: string | null;
  mutating: boolean;
  onSelectQueue: (queueName: string) => void;
  onPause: (queueName: string) => void;
  onResume: (queueName: string) => void;
  onCleanFailed: (queueName: string) => void;
}>;

export function QueuesOverviewGrid({
  queues,
  selectedQueue,
  mutating,
  onSelectQueue,
  onPause,
  onResume,
  onCleanFailed,
}: QueuesOverviewGridProps) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      role="list"
      aria-label="Lista cozi"
    >
      {queues.map((q, index) => (
        <QueueOverviewCard
          key={q.name}
          queue={q}
          display={getQueueDisplayInfo(q.name)}
          index={index}
          isSelected={q.name === selectedQueue}
          mutating={mutating}
          onSelect={() => onSelectQueue(q.name)}
          onPause={onPause}
          onResume={onResume}
          onCleanFailed={onCleanFailed}
        />
      ))}
    </div>
  );
}
