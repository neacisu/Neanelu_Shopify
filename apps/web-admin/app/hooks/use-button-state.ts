/**
 * Hook pentru state machine pe butoane: idle -> loading -> success/error -> idle.
 * Folosit pentru a oferi feedback vizual complet la acțiuni asincrone.
 *
 * Respectă prefers-reduced-motion: în mod reduced-motion, starea success/error
 * este afișată mai scurt (100ms vs 1500ms default).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ButtonActionState = 'idle' | 'loading' | 'success' | 'error';

export interface UseButtonStateOptions {
  /** Durata în ms în care starea success/error este vizibilă înainte de reset. Default 1500ms. */
  feedbackMs?: number;
  /** Dacă true, nu resetează automat la 'idle' după success/error. */
  noAutoReset?: boolean;
}

export interface UseButtonStateReturn {
  state: ButtonActionState;
  /** Execută acțiunea asincronă cu state machine. */
  run: (action: () => Promise<void>) => Promise<void>;
  /** Resetează manual starea la 'idle'. */
  reset: () => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useButtonState(options: UseButtonStateOptions = {}): UseButtonStateReturn {
  const { feedbackMs = 1500, noAutoReset = false } = options;
  const [state, setState] = useState<ButtonActionState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState('idle');
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
      setState('loading');
      try {
        await action();
        setState('success');
        if (!noAutoReset) {
          const delay = prefersReducedMotion() ? 100 : feedbackMs;
          timerRef.current = setTimeout(() => {
            setState('idle');
            timerRef.current = null;
          }, delay);
        }
      } catch {
        setState('error');
        if (!noAutoReset) {
          const delay = prefersReducedMotion() ? 100 : feedbackMs;
          timerRef.current = setTimeout(() => {
            setState('idle');
            timerRef.current = null;
          }, delay);
        }
      }
    },
    [feedbackMs, noAutoReset]
  );

  return {
    state,
    run,
    reset,
    isLoading: state === 'loading',
    isSuccess: state === 'success',
    isError: state === 'error',
  };
}
