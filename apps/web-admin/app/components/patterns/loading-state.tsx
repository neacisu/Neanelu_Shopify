export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-muted/20 bg-background p-4 text-body text-muted"
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block size-4 animate-spin rounded-full border-2 border-muted/40 border-t-muted"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}
