/**
 * Hook pentru feedback vizual la copierea în clipboard.
 * Returnează o funcție copy și starea: 'idle' | 'copied' | 'error'.
 * Se resetează automat după `resetMs` milisecunde (implicit 2000ms).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'error';

export interface UseCopyToClipboardOptions {
  /** Durata în ms după care starea se resetează la 'idle'. Default 2000. */
  resetMs?: number;
}

export function useCopyToClipboard(options: UseCopyToClipboardOptions = {}) {
  const { resetMs = 2000 } = options;
  const [state, setState] = useState<CopyState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string) => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
      try {
        await navigator.clipboard.writeText(text);
        setState('copied');
      } catch {
        setState('error');
      }
      timerRef.current = setTimeout(() => {
        setState('idle');
        timerRef.current = null;
      }, resetMs);
    },
    [resetMs]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { copy, state };
}
