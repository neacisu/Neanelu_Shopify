import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, X } from 'lucide-react';
import { DayPicker, type DateRange } from 'react-day-picker';
import type { Locale } from 'date-fns';

import 'react-day-picker/style.css';

import { Button } from './button';
import {
  formatDateRangeLabel,
  getDateRangePresets,
  type DateRangePreset,
} from '../../utils/date-range';

export type DateRangePickerProps = Readonly<{
  label?: string;
  value: DateRange | undefined;
  onChange: (next: DateRange | undefined) => void;

  minDate?: Date;
  maxDate?: Date;

  /** Optional custom presets; defaults to Today / Last 7 days / This month. */
  presets?: readonly DateRangePreset[];

  /** Locale for the calendar UI (react-day-picker/date-fns). */
  locale?: Locale;

  /** Optional timezone (IANA) for formatting the label; defaults to browser time zone. */
  timeZone?: string;

  disabled?: boolean;
  className?: string;

  /** Test hook: override "now" for deterministic default presets. */
  now?: Date;
}>;

export function DateRangePicker(props: DateRangePickerProps) {
  const {
    label = 'Date range',
    value,
    onChange,
    minDate,
    maxDate,
    presets: presetsProp,
    locale,
    timeZone,
    disabled,
    className,
    now,
  } = props;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(value);

  const popupId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstPresetRef = useRef<HTMLButtonElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to trigger for keyboard users.
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    // Focus first actionable element inside the popup.
    (firstPresetRef.current ?? clearButtonRef.current)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };

    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [close, open]);

  const tz =
    timeZone ??
    (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');

  const presets = useMemo(() => {
    if (presetsProp) return Array.from(presetsProp);
    return getDateRangePresets({ now: now ?? new Date(), timeZone: tz });
  }, [now, presetsProp, tz]);

  const labelText = formatDateRangeLabel(value, { timeZone: tz });
  const previewRange = draft ?? value;
  const hasPreviewRange = previewRange?.from && previewRange?.to;

  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </label>
      <div className="mt-1">
        <Button
          type="button"
          variant="secondary"
          ref={triggerRef}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-white/70 px-4 py-2.5 text-left text-sm font-medium text-foreground shadow-[var(--shadow-sm)] backdrop-blur-sm transition-all duration-200 hover:bg-subtle/50 focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:border-slate-700 dark:bg-slate-900/70 dark:text-foreground dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)] sm:w-auto"
        >
          <span className="inline-flex items-center gap-2">
            <Calendar className="size-4 text-muted" aria-hidden />
            <span>{labelText}</span>
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </Button>

        {open ? (
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            id={popupId}
            aria-modal="false"
            className="date-range-picker-card mt-3 w-full min-w-0 max-w-[min(720px,100%)] rounded-2xl border border-white/20 bg-white/90 shadow-xl backdrop-blur-xl motion-safe:animate-[fadeSlideUp_0.25s_ease-out] dark:border-white/10 dark:bg-slate-900/90"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          >
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Selectează intervalul</h3>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-subtle hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                  aria-label="Închide"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {hasPreviewRange ? (
              <div className="border-b border-border bg-subtle/30 px-4 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Previzualizare interval
                </p>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {formatDateRangeLabel(previewRange, { timeZone: tz })}
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-0 md:flex-row">
              <aside className="shrink-0 border-b border-border bg-subtle/30 px-4 py-4 md:w-48 md:border-b-0 md:border-r dark:bg-subtle/20">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Rapid
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5 md:flex-col">
                  {presets.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      ref={idx === 0 ? firstPresetRef : undefined}
                      onClick={() => {
                        onChange(p.range);
                        close();
                      }}
                      className="rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground transition-all duration-200 hover:bg-card hover:shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-accent/30"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </aside>

              <div className="min-w-0 flex-1 p-4">
                <DayPicker
                  mode="range"
                  numberOfMonths={2}
                  selected={draft}
                  onSelect={setDraft}
                  showOutsideDays
                  className="date-range-picker-calendar"
                  {...(minDate ? { fromDate: minDate } : {})}
                  {...(maxDate ? { toDate: maxDate } : {})}
                  {...(locale ? { locale } : {})}
                />

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-subtle/30 px-4 py-3 dark:bg-subtle/20">
                  <button
                    type="button"
                    ref={clearButtonRef}
                    onClick={() => setDraft(undefined)}
                    className="text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/30"
                  >
                    Șterge
                  </button>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        close();
                        setDraft(value);
                      }}
                      className="rounded-lg transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
                    >
                      Anulare
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => {
                        onChange(draft);
                        close();
                      }}
                      className="rounded-lg transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
                    >
                      Aplică
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
