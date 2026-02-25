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

  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500">
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
          className="inline-flex w-full items-center justify-between gap-2 rounded-xl border-slate-200/90 bg-white px-4 py-2.5 text-left text-sm font-medium text-slate-700 shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-[var(--shadow-sm)] sm:w-auto"
        >
          <span className="inline-flex items-center gap-2">
            <Calendar className="size-4 text-slate-500" aria-hidden />
            <span>{labelText}</span>
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
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
            className="date-range-picker-card mt-3 w-full min-w-0 max-w-[min(720px,100%)] animate-[fadeSlideUp_0.25s_ease-out] rounded-2xl border border-slate-200/90 bg-white shadow-[var(--shadow-lg)] ring-1 ring-slate-900/5"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Selectează intervalul</h3>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  aria-label="Închide"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-0 md:flex-row">
              <aside className="shrink-0 border-b border-slate-100 bg-slate-50/50 px-4 py-4 md:w-48 md:border-b-0 md:border-r">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
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
                      className="rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-white hover:text-slate-800 hover:shadow-[var(--shadow-sm)]"
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

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                  <button
                    type="button"
                    ref={clearButtonRef}
                    onClick={() => setDraft(undefined)}
                    className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
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
