import { formatDistanceToNow } from 'date-fns';
import { X } from 'lucide-react';

type RecentSearch = Readonly<{
  query: string;
  timestamp: number;
}>;

type RecentSearchesDropdownProps = Readonly<{
  searches: readonly RecentSearch[];
  onSelect: (query: string) => void;
  onClear: () => void;
  className?: string;
}>;

export function RecentSearchesDropdown({
  searches,
  onSelect,
  onClear,
  className,
}: RecentSearchesDropdownProps) {
  if (searches.length === 0) return null;

  return (
    <div
      className={
        'rounded-xl border border-slate-200/90 bg-white shadow-[var(--shadow-md)] ' +
        (className ?? '')
      }
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
        <span>Căutări recente</span>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label="Șterge căutările recente"
        >
          <X className="size-3" />
          Șterge
        </button>
      </div>
      <div className="max-h-56 overflow-auto">
        {searches.map((item) => (
          <button
            key={`${item.query}:${item.timestamp}`}
            type="button"
            onClick={() => onSelect(item.query)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            <span className="truncate">{item.query}</span>
            <span className="shrink-0 text-[11px] text-slate-400">
              {formatDistanceToNow(item.timestamp, { addSuffix: true })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
