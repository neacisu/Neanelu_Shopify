import { InfoTooltip } from '../ui/info-tooltip';

type TrustScoreBadgeProps = Readonly<{
  score: number | null | undefined;
}>;

function getTone(score: number): string {
  if (score >= 0.8)
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (score >= 0.5) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
}

export function TrustScoreBadge({ score }: TrustScoreBadgeProps) {
  if (score == null || Number.isNaN(score)) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-medium text-slate-600 transition-transform duration-150 hover:scale-105 dark:bg-slate-700/60 dark:text-slate-400">
          N/A
        </span>
        <InfoTooltip title="Scor de încredere">
          Scorul de încredere nu este disponibil. Acest produs poate să nu aibă suficiente surse sau
          date pentru a calcula un scor. De exemplu, un produs cu o singură sursă de date nu poate
          fi comparat cu altele pentru a determina consistența. Sfat: adaugă mai multe surse de date
          pentru acest produs pentru a obține un scor de încredere.
        </InfoTooltip>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 ${getTone(score)}`}
      >
        {score.toFixed(2)}
      </span>
      <InfoTooltip title="Scor de încredere">
        Acest scor măsoară cât de fiabile sunt datele produsului, pe o scală de la 0 la 1. Un scor
        sub 0.5 (roșu) înseamnă că datele sunt contradictorii între surse sau provin din surse
        nesigure — de exemplu, prețul diferă cu peste 20% între surse. Un scor între 0.5 și 0.8
        (galben) înseamnă date parțial consistente, cu diferențe minore. Un scor peste 0.8 (verde)
        înseamnă date consistente și verificate din multiple surse. Sfat: pentru produse cu scor
        scăzut, verifică manual datele în panoul de conflicte înainte de sincronizare.
      </InfoTooltip>
    </span>
  );
}
