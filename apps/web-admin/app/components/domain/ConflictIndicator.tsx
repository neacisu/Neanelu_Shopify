import { InfoTooltip } from '../ui/info-tooltip';

type ConflictIndicatorProps = Readonly<{
  count: number;
}>;

export function ConflictIndicator({ count }: ConflictIndicatorProps) {
  if (!count || count <= 0) return null;

  const tone = count >= 3 ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning';

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 motion-safe:animate-pulse ${tone}`}
      >
        {count} {count === 1 ? 'conflict' : 'conflicte'}
      </span>
      <InfoTooltip title="Conflicte între surse">
        Acest indicator arată câte câmpuri ale produsului au valori diferite între sursele de date.
        De exemplu, dacă Amazon arată prețul 120 lei iar furnizorul arată 105 lei, aceasta contează
        ca un conflict. Cu {count} conflicte, produsul necesită atenție — trebuie ales manual ce
        valoare este corectă pentru fiecare câmp. Un număr mare de conflicte (3+) sugerează că
        sursele au date foarte diferite și merită verificat dacă se referă la același produs. Sfat:
        deschide detaliile produsului și rezolvă conflictele în panoul dedicat înainte de
        sincronizare.
      </InfoTooltip>
    </span>
  );
}
