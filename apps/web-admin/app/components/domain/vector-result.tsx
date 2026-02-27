import type { ProductSearchResult } from '@app/types';

type VectorResultProps = Readonly<{
  result: ProductSearchResult;
  onClick: () => void;
  showScore?: boolean;
  index?: number;
}>;

function scoreClass(score: number) {
  if (score >= 0.9) return 'bg-emerald-500 text-white';
  if (score >= 0.7) return 'bg-amber-400 text-black';
  return 'bg-red-500 text-white';
}

function formatPriceRange(result: ProductSearchResult): string | null {
  const range = result.priceRange;
  if (!range) return null;
  const min = Number(range.min);
  const max = Number(range.max);
  const currency = range.currency || 'RON';
  const formatter = new Intl.NumberFormat('ro-RO', { style: 'currency', currency });
  if (Number.isFinite(min) && Number.isFinite(max)) {
    if (min === max) return formatter.format(min);
    return `${formatter.format(min)} – ${formatter.format(max)}`;
  }
  return null;
}

export function VectorResultCard({
  result,
  onClick,
  showScore = true,
  index = 0,
}: VectorResultProps) {
  const priceLabel = formatPriceRange(result);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white/80 backdrop-blur-sm text-left shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-slate-300 hover:shadow-[var(--shadow-md)] hover:bg-white/90 dark:border-slate-700/60 dark:bg-slate-900/80 dark:hover:border-slate-600 dark:hover:bg-slate-800/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:focus-visible:ring-blue-400/50"
      style={{ animation: `fadeSlideUp 0.35s ease-out ${index * 60}ms both` }}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100/50 dark:bg-slate-800/50">
        {result.featuredImageUrl ? (
          <img
            src={result.featuredImageUrl}
            alt={result.title}
            className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400 dark:text-slate-500">
            Fără imagine
          </div>
        )}
        {showScore ? (
          <span
            className={`absolute right-3 top-3 rounded-lg px-2 py-1 text-[11px] font-semibold shadow-sm ${scoreClass(
              result.similarity
            )}`}
          >
            {result.similarity.toFixed(2)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 line-clamp-2">
          {result.title}
        </div>
        {result.vendor ? (
          <div className="text-xs text-slate-500 dark:text-slate-400">{result.vendor}</div>
        ) : null}
        {priceLabel ? (
          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{priceLabel}</div>
        ) : null}
      </div>
    </button>
  );
}
