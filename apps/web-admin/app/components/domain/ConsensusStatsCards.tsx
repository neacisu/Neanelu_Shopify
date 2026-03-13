import type { ConsensusStats } from '@app/types';
import { InfoTooltip } from '../ui/info-tooltip';

type ConsensusStatsCardsProps = Readonly<{
  stats: ConsensusStats;
}>;

export function ConsensusStatsCards({ stats }: ConsensusStatsCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-success">
          <span>Produse cu consens</span>
          <InfoTooltip title="Produse cu consens">
            Produsele cu consens au date agregate din multiple surse, fără conflicte. De ce
            contează: un consens calculat înseamnă date fiabile și Golden Record posibil. Exemplu:
            800 din 1000 produse au consens = situație bună. Sfat: crește numărul prin adăugarea de
            surse noi.
          </InfoTooltip>
        </div>
        <div className="text-h5 text-foreground">{stats.productsWithConsensus}</div>
      </div>
      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-warning">
          <span>Consens în așteptare</span>
          <InfoTooltip title="Consens în așteptare">
            Produsele în așteptare nu au încă un calcul de consens finalizat. De ce contează: un
            număr mare indică necesitatea de a rula recalcularea. Exemplu: 50 în așteptare = 50 de
            produse fără date agregate. Sfat: folosește butonul „Reîncarcă" pentru a declanșa
            procesarea.
          </InfoTooltip>
        </div>
        <div className="text-h5 text-foreground">{stats.pendingConsensus}</div>
      </div>
      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-error">
          <span>Conflicte</span>
          <InfoTooltip title="Conflicte">
            Conflictele apar când surse diferite furnizează valori contradictorii pentru același
            atribut. De ce contează: necesită rezolvare manuală pentru date corecte. Exemplu: două
            surse raportează prețuri diferite pentru același produs. Sfat: rezolvă conflictele
            prioritar pe produsele importante.
          </InfoTooltip>
        </div>
        <div className="text-h5 text-foreground">{stats.productsWithConflicts}</div>
      </div>
      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-success">
          <span>Rezolvate azi</span>
          <InfoTooltip title="Rezolvate azi">
            Rezolvate azi arată câte conflicte au fost soluționate manual în ziua curentă. De ce
            contează: reflectă ritmul de lucru al echipei pe consens. Exemplu: 15 rezolvate azi = 15
            produse au primit date corecte. Sfat: stabilește un obiectiv zilnic de rezolvare.
          </InfoTooltip>
        </div>
        <div className="text-h5 text-foreground">{stats.resolvedToday}</div>
      </div>
    </div>
  );
}
