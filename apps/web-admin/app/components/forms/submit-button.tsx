import type { ReactNode } from 'react';
import { Check, Loader2, RotateCcw } from 'lucide-react';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

export function SubmitButton({
  state,
  disabled,
  children,
}: {
  state: SubmitState;
  disabled?: boolean;
  children: ReactNode;
}) {
  const isDisabled = state === 'loading' || Boolean(disabled);

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[var(--shadow-md)] disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:text-slate-900 dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)]"
    >
      {state === 'loading' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {state === 'success' ? (
        <Check className="size-4 motion-safe:animate-[fadeIn_200ms_ease-out]" aria-hidden />
      ) : null}
      {state === 'error' ? <RotateCcw className="size-4" aria-hidden /> : null}
      <span>{children}</span>

      {state === 'loading' ? (
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent motion-safe:animate-[shimmer-loading_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
      ) : null}
    </button>
  );
}
