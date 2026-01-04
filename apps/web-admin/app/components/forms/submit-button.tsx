import type { ReactNode } from 'react';

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

export function SubmitButton({ state, children }: { state: SubmitState; children: ReactNode }) {
  const isDisabled = state === 'loading';

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-body text-background shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {state === 'loading' ? (
        <span
          className="inline-block size-4 animate-spin rounded-full border-2 border-background/50 border-t-background"
          aria-hidden="true"
        />
      ) : null}
      {state === 'success' ? <span aria-hidden="true">✓</span> : null}
      {state === 'error' ? <span aria-hidden="true">↻</span> : null}
      <span>{children}</span>
    </button>
  );
}
