import { useId, useState, useCallback } from 'react';
import type { ChangeEvent } from 'react';

export type SliderMark = Readonly<{ value: number; label?: string }>;

export type SliderProps = Readonly<{
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  description?: string;
  showValue?: boolean;
  formatValue?: (v: number) => string;
  marks?: readonly SliderMark[];
  onChange?: (value: number, e: ChangeEvent<HTMLInputElement>) => void;
  onChangeEnd?: (value: number) => void;
  className?: string;
  id?: string;
}>;

export function Slider({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  label,
  description,
  showValue = true,
  formatValue,
  marks,
  onChange,
  onChangeEnd,
  className = '',
  id,
}: SliderProps) {
  const uid = useId().replace(/:/g, '');
  const inputId = id ?? `slider-${uid}`;
  const [localValue, setLocalValue] = useState(value);

  const pct = Math.round(((localValue - min) / Math.max(max - min, 1)) * 100);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      setLocalValue(next);
      onChange?.(next, e);
    },
    [onChange]
  );

  const handlePointerUp = useCallback(() => {
    onChangeEnd?.(localValue);
  }, [localValue, onChangeEnd]);

  const displayValue = formatValue ? formatValue(localValue) : String(localValue);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {(label ?? showValue) ? (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <label htmlFor={inputId} className="text-sm font-medium text-foreground">
              {label}
            </label>
          ) : null}
          {showValue ? (
            <span
              className="tabular-nums text-sm font-medium text-primary motion-safe:animate-[number-pop_0.2s_ease-out_both]"
              key={localValue}
            >
              {displayValue}
            </span>
          ) : null}
        </div>
      ) : null}

      {description ? <p className="text-xs text-muted">{description}</p> : null}

      <div className="relative flex items-center py-1.5">
        <div
          className="pointer-events-none absolute inset-x-0 h-1.5 rounded-full bg-border"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-0 h-1.5 rounded-full bg-primary transition-[width] duration-fast"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
        {marks?.map((mark) => {
          const markPct = Math.round(((mark.value - min) / Math.max(max - min, 1)) * 100);
          return (
            <div
              key={mark.value}
              className="pointer-events-none absolute"
              style={{ left: `${markPct}%` }}
              aria-hidden
            >
              <div className="h-1.5 w-0.5 -translate-x-0.5 rounded-full bg-muted/60" />
              {mark.label ? (
                <span className="absolute left-1/2 top-3.5 -translate-x-1/2 text-[10px] text-muted whitespace-nowrap">
                  {mark.label}
                </span>
              ) : null}
            </div>
          );
        })}
        <input
          type="range"
          id={inputId}
          min={min}
          max={max}
          step={step}
          value={localValue}
          disabled={disabled}
          onChange={handleChange}
          onPointerUp={handlePointerUp}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={localValue}
          aria-valuetext={displayValue}
          className="
 relative w-full cursor-pointer appearance-none bg-transparent
        focus-ring-standard
 disabled:cursor-not-allowed disabled:opacity-50
 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary
 [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow-[var(--shadow-sm)]
 [&::-webkit-slider-thumb]:transition-[transform,box-shadow] [&::-webkit-slider-thumb]:duration-fast
 [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:hover:shadow-[var(--shadow-md)]
 [&::-webkit-slider-thumb]:active:scale-95
 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary
 [&::-moz-range-thumb]:bg-card [&::-moz-range-thumb]:shadow-[var(--shadow-sm)]
 "
        />
      </div>

      {marks ? <div className="mt-3" aria-hidden /> : null}
    </div>
  );
}
