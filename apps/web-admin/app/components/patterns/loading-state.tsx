export function LoadingState({ label = 'Se încarcă…' }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted transition-colors"
      role="status"
      aria-live="polite"
    >
      <div className="relative size-5">
        <span className="absolute inset-0 rounded-full border-2 border-primary/20" aria-hidden />
        <span
          className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary"
          aria-hidden
        />
      </div>
      <span>{label}</span>
    </div>
  );
}
