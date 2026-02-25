import type { ProductSearchResult } from '@app/types';

type VectorResultProps = Readonly<{
  result: ProductSearchResult;
  onClick: () => void;
  showScore?: boolean;
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

export function VectorResultCard({ result, onClick, showScore = true }: VectorResultProps) {
  const priceLabel = formatPriceRange(result);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white text-left shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-slate-300 hover:shadow-[var(--shadow-md)]"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100/50">
        {result.featuredImageUrl ? (
          <img
            src={result.featuredImageUrl}
            alt={result.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
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
        <div className="text-sm font-semibold text-slate-800 line-clamp-2">{result.title}</div>
        {result.vendor ? <div className="text-xs text-slate-500">{result.vendor}</div> : null}
        {priceLabel ? <div className="text-sm font-medium text-slate-700">{priceLabel}</div> : null}
      </div>
    </button>
  );
}
