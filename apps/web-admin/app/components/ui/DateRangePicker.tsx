import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';

import { Button } from './button';
import { formatDateRangeLabel, getDateRangePresets } from '../../utils/date-range';

export type DateRangePickerProps = Readonly<{
  label?: string;
  value: DateRange | undefined;
  onChange: (next: DateRange | undefined) => void;

  /** Shop timezone (IANA), e.g. "Europe/Bucharest". */
  timeZone: string;

  disabled?: boolean;
  className?: string;

  /** Test hook: override "now" for deterministic presets. */
  now?: Date;
}>;

export function DateRangePicker(props: DateRangePickerProps) {
  const { label = 'Date range', value, onChange, timeZone, disabled, className, now } = props;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(value);

  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const presets = useMemo(
    () => getDateRangePresets({ now: now ?? new Date(), timeZone }),
    [now, timeZone]
  );

  const labelText = formatDateRangeLabel(value, { timeZone });

  return (
    <div className={className}>
      <div className="text-caption text-muted">{label}</div>
      <div className="relative mt-1" ref={panelRef}>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {labelText}
        </Button>

        {open ? (
          <div
            role="dialog"
            aria-label={label}
            className="absolute z-50 mt-2 w-[min(720px,calc(100vw-2rem))] rounded-md border bg-background p-3 shadow"
          >
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="w-full md:w-44">
                <div className="text-caption text-muted">Presets</div>
                <div className="mt-2 space-y-2">
                  {presets.map((p) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => {
                        onChange(p.range);
                        setOpen(false);
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
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
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
                        setOpen(false);
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
                        setOpen(false);
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
