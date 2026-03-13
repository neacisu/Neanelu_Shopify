import { Check, Copy, X } from 'lucide-react';

import { useCopyToClipboard } from '../../hooks/use-copy-to-clipboard.js';

export interface CopyButtonProps {
  /** Textul care va fi copiat în clipboard */
  text: string;
  /** Label accesibil. Default: 'Copiază' */
  label?: string;
  /** Clasa CSS suplimentară */
  className?: string;
  /** Dimensiune icon. Default: 'sm' (size-3.5) */
  size?: 'sm' | 'md';
}

/**
 * Buton compact de copiere cu feedback vizual: idle → copied (✓) → idle.
 * Folosit în JsonViewer, cod inline, API keys, etc.
 */
export function CopyButton({
  text,
  label = 'Copiază',
  className = '',
  size = 'sm',
}: CopyButtonProps) {
  const { copy, state } = useCopyToClipboard();
  const iconClass = size === 'sm' ? 'size-3.5' : 'size-4';

  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      aria-label={state === 'copied' ? 'Copiat!' : state === 'error' ? 'Eroare la copiere' : label}
      title={state === 'copied' ? 'Copiat!' : label}
      disabled={state === 'copied'}
      className={`
        interactive inline-flex items-center justify-center rounded-md p-1 text-muted
        transition-all duration-150
        hover:bg-subtle hover:text-foreground
        focus-ring-standard
        disabled:pointer-events-none
        ${state === 'copied' ? 'text-success' : ''}
        ${state === 'error' ? 'text-error' : ''}
        ${className}
      `}
    >
      {state === 'copied' ? (
        <Check
          className={`${iconClass} motion-safe:animate-[scaleIn_0.15s_ease-out]`}
          aria-hidden
        />
      ) : state === 'error' ? (
        <X className={iconClass} aria-hidden />
      ) : (
        <Copy className={iconClass} aria-hidden />
      )}
    </button>
  );
}
