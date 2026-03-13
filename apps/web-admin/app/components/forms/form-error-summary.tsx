import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';

import { ErrorList } from '../errors/error-list';

export function FormErrorSummary({
  errors,
  title = 'Te rugăm să corectezi următoarele erori',
}: {
  errors: Record<string, string[]> | undefined;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(true);

  const entries = errors ? Object.entries(errors).filter(([, msgs]) => msgs.length > 0) : [];

  useEffect(() => {
    if (entries.length > 0) {
      ref.current?.focus();
      setExpanded(true);
    }
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-xl border border-error/30 bg-error/5 p-4 shadow-[var(--shadow-sm)] focus-ring-standard"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-error" />
          <span className="text-sm font-semibold text-error">{title}</span>
        </div>
        <ChevronDown
          className={`size-4 text-error transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded ? (
        <div className="mt-2 motion-safe:animate-[fadeSlideUp_0.15s_ease-out]">
          <ErrorList errors={errors ?? {}} />
        </div>
      ) : null}
    </div>
  );
}
