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
    <div className={`rounded-md border bg-background shadow ${className ?? ''}`}>
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted">
        <span>Recent searches</span>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
          aria-label="Clear recent searches"
        >
          <X className="size-3" />
          Clear
        </button>
      </div>
      <div className="max-h-56 overflow-auto">
        {searches.map((item) => (
          <button
            key={`${item.query}:${item.timestamp}`}
            type="button"
            onClick={() => onSelect(item.query)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/20"
          >
            <span className="truncate">{item.query}</span>
            <span className="shrink-0 text-[11px] text-muted">
              {formatDistanceToNow(item.timestamp, { addSuffix: true })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
