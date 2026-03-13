import { Badge } from '../ui/badge.js';
import { InfoTooltip } from '../ui/info-tooltip.js';

type TrustScoreBadgeProps = Readonly<{
  score: number | null | undefined;
}>;

function getTone(score: number): 'success' | 'warning' | 'critical' {
  if (score >= 0.8) return 'success';
  if (score >= 0.5) return 'warning';
  return 'critical';
}

export function TrustScoreBadge({ score }: TrustScoreBadgeProps) {
  if (score == null || Number.isNaN(score)) {
    return (
      <span className="inline-flex items-center gap-1">
        <Badge tone="neutral">N/A</Badge>
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
      <Badge tone={getTone(score)}>{score.toFixed(2)}</Badge>
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
