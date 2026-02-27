/**
 * Hook pentru animație count-up pe valori numerice KPI.
 * Respectă prefers-reduced-motion: când e activ, returnează direct valoarea finală.
 */

import { useEffect, useRef, useState } from 'react';

export interface UseCountUpOptions {
  /** Durata animației în ms */
  duration?: number;
  /** Funcție de formatare: (n: number) => string */
  format?: (value: number) => string;
  /** Dacă true, nu anima (ex: când preferă reduced motion) */
  disabled?: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(target: number, options: UseCountUpOptions = {}): string {
  const {
    duration = 800,
    format = (n) => Math.round(n).toLocaleString('ro-RO'),
    disabled = false,
  } = options;
  const [displayValue, setDisplayValue] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const reducedMotion = prefersReducedMotion();
  const skipAnimation = disabled || reducedMotion;

  displayRef.current = displayValue;

  useEffect(() => {
    if (skipAnimation) {
      setDisplayValue(target);
      return;
    }

    const start = displayRef.current;
    const diff = target - start;
    if (diff === 0) return;

    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - (1 - progress) ** 2;
      setDisplayValue(start + diff * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, skipAnimation]);

  return format(displayValue);
}
