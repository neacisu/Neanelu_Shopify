/**
 * Indicator vizual pentru conexiuni WebSocket/SSE active.
 * Afișează un punct pulsant când stream-ul este activ.
 */

export interface StreamingIndicatorProps {
  /** Dacă stream-ul este activ */
  active: boolean;
  /** Eticheta pentru screen readers și tooltip */
  label?: string;
  /** Varianta de culoare. Default 'success' (verde). */
  variant?: 'success' | 'primary' | 'warning';
  /** Clasa CSS suplimentară */
  className?: string;
  /** Afișează textul label lângă indicator */
  showLabel?: boolean;
}

const VARIANT_CLASSES = {
  success: 'bg-success',
  primary: 'bg-primary',
  warning: 'bg-warning',
} as const;

const RING_CLASSES = {
  success: 'ring-success/40',
  primary: 'ring-primary/40',
  warning: 'ring-warning/40',
} as const;

export function StreamingIndicator({
  active,
  label = 'Stream activ',
  variant = 'success',
  className = '',
  showLabel = false,
}: StreamingIndicatorProps) {
  if (!active) {
    return (
      <span
        className={`inline-flex size-2 rounded-full bg-muted/40 ${className}`}
        aria-label="Stream inactiv"
        aria-hidden={!showLabel}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={label}
      role="status"
      aria-label={label}
      aria-live="polite"
    >
      <span
        className={`
          relative inline-flex size-2 rounded-full
          ${VARIANT_CLASSES[variant]}
          ring-2 ${RING_CLASSES[variant]}
          motion-safe:animate-[queueLivePulse_1.5s_ease-in-out_infinite]
        `}
        aria-hidden
      />
      {showLabel ? <span className="text-xs text-muted">{label}</span> : null}
    </span>
  );
}
