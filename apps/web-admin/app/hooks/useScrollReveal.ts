/**
 * Hook pentru reveal la scroll bazat pe IntersectionObserver.
 * Respectă prefers-reduced-motion: când utilizatorul preferă mișcare redusă, elementul e considerat vizibil imediat.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseScrollRevealOptions {
  /** Root margin pentru IntersectionObserver (ex: "0px 0px -50px 0px" = 50px înainte de viewport) */
  rootMargin?: string;
  /** Threshold 0–1 pentru cât din element trebuie vizibil */
  threshold?: number;
  /** Dacă true, nu mai observă după prima vizibilitate (one-shot) */
  once?: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options: UseScrollRevealOptions = {}
): [React.RefObject<T | null>, boolean] {
  const { rootMargin = '0px 0px -24px 0px', threshold = 0.15, once = true } = options;
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const reducedMotion = prefersReducedMotion();

  const handleIntersect = useCallback<IntersectionObserverCallback>(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.isIntersecting) {
        setIsVisible(true);
      } else if (!once) {
        setIsVisible(false);
      }
    },
    [once]
  );

  useEffect(() => {
    if (reducedMotion) {
      setIsVisible(true);
      return;
    }

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(handleIntersect, { rootMargin, threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleIntersect, rootMargin, reducedMotion, threshold]);

  return [ref, isVisible];
}
