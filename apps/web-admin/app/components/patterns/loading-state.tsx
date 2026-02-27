export function LoadingState({ label = 'Se încarcă…' }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm text-muted transition-colors dark:border-slate-700 dark:bg-slate-800/50"
      role="status"
      aria-live="polite"
    >
      <div className="relative size-5">
        <span
          className="absolute inset-0 rounded-full border-2 border-blue-200 dark:border-blue-800/50"
          aria-hidden
        />
        <span
          className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-blue-500 dark:border-t-blue-400"
          aria-hidden
        />
      </div>
      <span>{label}</span>
    </div>
  );
}
