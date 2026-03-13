import { useEffect, useRef, useState } from 'react';

type Phase = 'skeleton' | 'fade-out' | 'content';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSkeletonTransition(isLoading: boolean): {
  phase: Phase;
  skeletonStyle: React.CSSProperties;
  contentStyle: React.CSSProperties;
} {
  const [phase, setPhase] = useState<Phase>(isLoading ? 'skeleton' : 'content');
  const timer = useRef<number | null>(null);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);

    if (isLoading) {
      setPhase('skeleton');
      return;
    }

    if (reduced) {
      setPhase('content');
      return;
    }

    setPhase('fade-out');
    timer.current = window.setTimeout(() => {
      setPhase('content');
      timer.current = null;
    }, 200);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [isLoading, reduced]);

  const skeletonStyle: React.CSSProperties =
    phase === 'skeleton'
      ? { opacity: 1 }
      : phase === 'fade-out'
        ? { opacity: 0, transition: 'opacity 200ms ease-out' }
        : { display: 'none' };

  const contentStyle: React.CSSProperties =
    phase === 'content'
      ? { opacity: 1, transition: 'opacity 300ms ease-out', animationFillMode: 'both' }
      : { display: 'none' };

  return { phase, skeletonStyle, contentStyle };
}
