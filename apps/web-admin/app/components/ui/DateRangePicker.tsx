import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import type { Locale } from 'date-fns';

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
      if (!panelRef.current) return;
      if (panelRef.current.contains(target)) return;
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
      <div className="text-caption text-muted">{label}</div>
      <div className="relative mt-1" ref={panelRef}>
        <Button
          type="button"
          variant="secondary"
          ref={triggerRef}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          {labelText}
        </Button>

        {open ? (
          <div
            role="dialog"
            aria-label={label}
            id={popupId}
            aria-modal="false"
            className="absolute z-50 mt-2 w-[min(720px,calc(100vw-2rem))] rounded-md border bg-background p-3 shadow"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          >
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="w-full md:w-44">
                <div className="text-caption text-muted">Presets</div>
                <div className="mt-2 space-y-2">
                  {presets.map((p, idx) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      ref={idx === 0 ? firstPresetRef : undefined}
                      onClick={() => {
                        onChange(p.range);
                        close();
                      }}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <DayPicker
                  mode="range"
                  numberOfMonths={2}
                  selected={draft}
                  onSelect={setDraft}
                  showOutsideDays
                  {...(minDate ? { fromDate: minDate } : {})}
                  {...(maxDate ? { toDate: maxDate } : {})}
                  {...(locale ? { locale } : {})}
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    ref={clearButtonRef}
                    onClick={() => {
                      setDraft(undefined);
                    }}
                  >
                    Clear
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        close();
                        setDraft(value);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => {
                        onChange(draft);
                        close();
                      }}
                    >
                      Apply
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
