import { Info } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type InfoTooltipProps = Readonly<{
  title: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  maxWidth?: number;
}>;

type Align = 'center' | 'start' | 'end';

function getContentAreaLeft(el: HTMLElement): number {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    const ov = style.overflow + style.overflowX + style.overflowY;
    if (ov.includes('auto') || ov.includes('scroll') || ov.includes('hidden')) {
      return parent.getBoundingClientRect().left;
    }
    parent = parent.parentElement;
  }
  return 0;
}

export function InfoTooltip({
  title,
  children,
  side = 'bottom',
  maxWidth = 425,
}: InfoTooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<Align>('center');

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(
    (ms = 120) => {
      clearCloseTimer();
      closeTimer.current = setTimeout(() => setOpen(false), ms);
    },
    [clearCloseTimer]
  );

  const handleEnter = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handleLeave = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey, { passive: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const triggerCenter = triggerRect.left + triggerRect.width / 2;
    const leftBound = getContentAreaLeft(triggerRef.current) + 8;
    const rightBound = window.innerWidth - 16;

    if (triggerCenter - maxWidth / 2 < leftBound) {
      setAlign('start');
    } else if (triggerCenter + maxWidth / 2 > rightBound) {
      setAlign('end');
    } else {
      setAlign('center');
    }
  }, [open, maxWidth]);

  const verticalPos = side === 'top' ? 'bottom-full mb-[10px]' : 'top-full mt-[10px]';

  const horizontalPos =
    align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2';

  const arrowVertical =
    side === 'top'
      ? 'top-full border-t-gray-800 border-x-transparent border-b-transparent'
      : 'bottom-full border-b-gray-800 border-x-transparent border-t-transparent';

  const arrowHorizontal =
    align === 'start'
      ? 'left-[6px]'
      : align === 'end'
        ? 'right-[6px]'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={id}
        className="inline-flex items-center justify-center rounded-full p-0.5
                   text-muted/60 transition-all duration-200
                   hover:text-primary hover:scale-110
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
      >
        <Info className="size-4" />
      </button>

      <div
        ref={popoverRef}
        id={id}
        role="tooltip"
        aria-hidden={!open}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{ width: maxWidth, maxWidth }}
        className={`
          absolute z-50 ${verticalPos} ${horizontalPos}
          rounded-lg bg-gray-800 px-4 py-3 text-left text-sm leading-relaxed text-gray-100
          shadow-lg shadow-black/20 ring-1 ring-white/10
          transition-all duration-200 ease-out
          ${
            open
              ? 'pointer-events-auto scale-100 opacity-100'
              : 'pointer-events-none scale-95 opacity-0'
          }
        `}
      >
        <span className={`absolute ${arrowVertical} ${arrowHorizontal} h-0 w-0 border-[6px]`} />

        <div className="mb-1.5 text-[13px] font-semibold text-white">{title}</div>
        <div className="text-[12.5px] leading-[1.6] text-gray-300">{children}</div>
      </div>
    </span>
  );
}
