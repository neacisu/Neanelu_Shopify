import { Info } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type InfoTooltipProps = Readonly<{
  title: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  maxWidth?: number;
  /** Dacă e furnizat, tooltip-ul se poziționează în viewport (portal) și rămâne în interiorul acestui element (ex. card). Evită suprapunerea cu carduri vecine. */
  boundaryRef?: React.RefObject<HTMLElement | null>;
  /** Randare în portal pe body cu z-index foarte mare; tooltip-ul rămâne deasupra tuturor (ex. navigare sidebar). */
  portalToBody?: boolean;
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

const ARROW_OFFSET = 6;
const GAP = 10;
const BOUNDARY_PAD = 8;
/** Înălțime estimată pentru tooltip (poziționare în boundary); evitat tăierea verticală. */
const ESTIMATED_TOOLTIP_HEIGHT = 200;

const TOOLTIP_Z_INDEX = 99999;

export function InfoTooltip({
  title,
  children,
  side = 'bottom',
  maxWidth = 425,
  boundaryRef,
  portalToBody = true,
}: InfoTooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<Align>('center');
  const [portalPosition, setPortalPosition] = useState<{
    left: number;
    top: number;
    arrowLeft: number;
    /** Lățime efectivă (încapă în boundary); folosită pentru poziționare și randare. */
    effectiveWidth: number;
    /** Poziția efectivă: 'top' | 'bottom' pentru săgeată și layout. */
    effectiveSide: 'top' | 'bottom';
  } | null>(null);
  const [bodyPortalPosition, setBodyPortalPosition] = useState<{
    left: number;
    top: number;
    arrowLeft: number;
    effectiveWidth: number;
    effectiveSide: 'top' | 'bottom';
  } | null>(null);

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

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    clearCloseTimer();
    if (open) return;
    clearOpenTimer();
    openTimer.current = setTimeout(() => setOpen(true), 200);
  }, [clearCloseTimer, clearOpenTimer, open]);

  const handleLeave = useCallback(() => {
    clearOpenTimer();
    scheduleClose();
  }, [clearOpenTimer, scheduleClose]);

  useEffect(
    () => () => {
      clearCloseTimer();
      clearOpenTimer();
    },
    [clearCloseTimer, clearOpenTimer]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey, { passive: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const updateBodyPortalPosition = useCallback(() => {
    if (!triggerRef.current || !open || !portalToBody) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const effectiveWidth = Math.min(maxWidth, window.innerWidth - 2 * BOUNDARY_PAD);
    const triggerCenter = triggerRect.left + triggerRect.width / 2;
    let left = triggerCenter - effectiveWidth / 2;
    left = Math.max(
      BOUNDARY_PAD,
      Math.min(window.innerWidth - effectiveWidth - BOUNDARY_PAD, left)
    );
    const arrowLeft = Math.max(
      ARROW_OFFSET,
      Math.min(effectiveWidth - ARROW_OFFSET, triggerCenter - left)
    );
    const spaceBelow = window.innerHeight - triggerRect.bottom - GAP - BOUNDARY_PAD;
    const spaceAbove = triggerRect.top - BOUNDARY_PAD;
    const preferBottom = side === 'bottom' || (side !== 'top' && spaceBelow >= spaceAbove);
    let top: number;
    let effectiveSide: 'top' | 'bottom';
    if (preferBottom && spaceBelow >= ESTIMATED_TOOLTIP_HEIGHT * 0.5) {
      top = Math.min(
        window.innerHeight - ESTIMATED_TOOLTIP_HEIGHT - BOUNDARY_PAD,
        Math.max(BOUNDARY_PAD, triggerRect.bottom + GAP)
      );
      effectiveSide = 'bottom';
    } else {
      top = Math.max(
        BOUNDARY_PAD,
        Math.min(
          triggerRect.top - GAP - ESTIMATED_TOOLTIP_HEIGHT,
          window.innerHeight - ESTIMATED_TOOLTIP_HEIGHT - BOUNDARY_PAD
        )
      );
      effectiveSide = 'top';
    }
    setBodyPortalPosition({ left, top, arrowLeft, effectiveWidth, effectiveSide });
  }, [open, maxWidth, portalToBody, side]);

  const updatePortalPosition = useCallback(() => {
    if (!triggerRef.current || !open) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const triggerCenter = triggerRect.left + triggerRect.width / 2;

    if (boundaryRef?.current) {
      const boundaryRect = boundaryRef.current.getBoundingClientRect();
      const boundaryWidth = Math.max(0, boundaryRect.width - 2 * BOUNDARY_PAD);
      const effectiveWidth = Math.min(maxWidth, boundaryWidth);
      const minLeft = boundaryRect.left + BOUNDARY_PAD;
      const maxLeft = boundaryRect.right - BOUNDARY_PAD - effectiveWidth;
      const idealLeft = triggerCenter - effectiveWidth / 2;
      const left = Math.min(maxLeft, Math.max(minLeft, idealLeft));
      const arrowLeft = Math.max(
        ARROW_OFFSET,
        Math.min(effectiveWidth - ARROW_OFFSET, triggerCenter - left)
      );

      const minTop = boundaryRect.top + BOUNDARY_PAD;
      const maxTop = boundaryRect.bottom - BOUNDARY_PAD - ESTIMATED_TOOLTIP_HEIGHT;

      const spaceAbove = triggerRect.top - boundaryRect.top - BOUNDARY_PAD;
      const spaceBelow = boundaryRect.bottom - triggerRect.bottom - GAP - BOUNDARY_PAD;
      const preferBottom = spaceBelow >= spaceAbove && spaceBelow >= ESTIMATED_TOOLTIP_HEIGHT * 0.5;

      let top: number;
      let effectiveSide: 'top' | 'bottom';

      if (preferBottom) {
        const idealTop = triggerRect.bottom + GAP;
        top = Math.min(maxTop, Math.max(minTop, idealTop));
        effectiveSide = 'bottom';
      } else {
        const idealTop = triggerRect.top - GAP - ESTIMATED_TOOLTIP_HEIGHT;
        top = Math.min(maxTop, Math.max(minTop, idealTop));
        effectiveSide = 'top';
      }

      setPortalPosition({ left, top, arrowLeft, effectiveWidth, effectiveSide });
    } else {
      setPortalPosition(null);
    }
  }, [open, maxWidth, boundaryRef]);

  useEffect(() => {
    if (!open) {
      setBodyPortalPosition(null);
      return;
    }
    if (portalToBody) {
      updateBodyPortalPosition();
      const onScrollOrResize = () => updateBodyPortalPosition();
      window.addEventListener('scroll', onScrollOrResize, { capture: true });
      window.addEventListener('resize', onScrollOrResize);
      return () => {
        window.removeEventListener('scroll', onScrollOrResize, { capture: true });
        window.removeEventListener('resize', onScrollOrResize);
        setBodyPortalPosition(null);
      };
    }
    if (!boundaryRef?.current) return;
    updatePortalPosition();
    const onScrollOrResize = () => updatePortalPosition();
    window.addEventListener('scroll', onScrollOrResize, { capture: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, { capture: true });
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, boundaryRef, portalToBody, updatePortalPosition, updateBodyPortalPosition]);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    if (boundaryRef?.current) return;
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
  }, [open, maxWidth, boundaryRef]);

  const verticalPos = side === 'top' ? 'bottom-full mb-[10px]' : 'top-full mt-[10px]';
  const horizontalPos =
    align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2';

  const arrowVertical =
    side === 'top'
      ? 'top-full border-t-slate-800 border-x-transparent border-b-transparent'
      : 'bottom-full border-b-slate-800 border-x-transparent border-t-transparent';

  const arrowHorizontal =
    align === 'start'
      ? 'left-[6px]'
      : align === 'end'
        ? 'right-[6px]'
        : 'left-1/2 -translate-x-1/2';

  const effectivePortalPos = portalToBody ? bodyPortalPosition : portalPosition;
  const tooltipContent = (
    <span
      ref={popoverRef}
      id={id}
      role="tooltip"
      aria-hidden={!open}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        ...(effectivePortalPos?.effectiveWidth != null
          ? {
              width: effectivePortalPos.effectiveWidth,
              maxWidth: effectivePortalPos.effectiveWidth,
              maxHeight: ESTIMATED_TOOLTIP_HEIGHT,
              overflowY: 'auto' as const,
            }
          : { width: maxWidth, maxWidth }),
      }}
      className={`
        relative block rounded-lg bg-slate-800 px-4 py-3 text-left text-sm normal-case leading-relaxed text-slate-100
        shadow-lg shadow-black/20 ring-1 ring-white/10
        transition-all duration-200 ease-out
        ${
          open
            ? 'pointer-events-auto scale-100 opacity-100'
            : 'pointer-events-none scale-95 opacity-0'
        }
      `}
    >
      {effectivePortalPos != null ? (
        <span
          className={`absolute left-0 h-0 w-0 border-[6px] border-x-transparent ${
            effectivePortalPos.effectiveSide === 'top'
              ? 'border-t-slate-800 border-b-transparent'
              : 'border-b-slate-800 border-t-transparent'
          }`}
          style={{
            ...(effectivePortalPos.effectiveSide === 'bottom'
              ? { bottom: '100%', transform: 'translateX(-50%) translateY(-6px)' }
              : { top: '100%', transform: 'translateX(-50%) translateY(6px)' }),
            left: effectivePortalPos.arrowLeft,
          }}
          aria-hidden
        />
      ) : (
        <span className={`absolute ${arrowVertical} ${arrowHorizontal} h-0 w-0 border-[6px]`} />
      )}

      <span className="mb-1.5 block text-[13px] font-semibold text-white dark:text-slate-100">
        {title}
      </span>
      <span className="block text-[12.5px] leading-[1.6] text-slate-300 dark:text-slate-300">
        {children}
      </span>
    </span>
  );

  const useBoundaryPortal = boundaryRef != null && open && portalPosition != null;
  const useBodyPortal = portalToBody && open && bodyPortalPosition != null;

  return (
    <span className="relative inline-flex">
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-describedby={id}
        className="inline-flex cursor-pointer items-center justify-center rounded-full p-0.5
                   text-muted/60 transition-all duration-200
                   hover:text-primary hover:scale-110
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
      >
        <Info className="size-4" />
      </span>

      {useBoundaryPortal && portalPosition != null && typeof document !== 'undefined'
        ? createPortal(
            <div
              onMouseEnter={handleEnter}
              onMouseLeave={handleLeave}
              style={{
                position: 'fixed',
                left: portalPosition.left,
                top: portalPosition.top,
                zIndex: TOOLTIP_Z_INDEX,
              }}
              className="pointer-events-none"
            >
              <div className="pointer-events-auto">{tooltipContent}</div>
            </div>,
            document.body
          )
        : null}

      {useBodyPortal && bodyPortalPosition != null && typeof document !== 'undefined'
        ? createPortal(
            <div
              onMouseEnter={handleEnter}
              onMouseLeave={handleLeave}
              style={{
                position: 'fixed',
                left: bodyPortalPosition.left,
                top: bodyPortalPosition.top,
                zIndex: TOOLTIP_Z_INDEX,
              }}
              className="pointer-events-none"
            >
              <div className="pointer-events-auto">{tooltipContent}</div>
            </div>,
            document.body
          )
        : null}

      {!useBoundaryPortal && !useBodyPortal && boundaryRef == null && !portalToBody ? (
        <span
          className={`
            absolute z-50 block ${verticalPos} ${horizontalPos}
            ${open ? '' : 'invisible'}
          `}
        >
          {tooltipContent}
        </span>
      ) : null}
    </span>
  );
}
