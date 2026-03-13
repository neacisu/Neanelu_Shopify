import { GaugeChart } from '../charts/GaugeChart';
import { Sparkline } from '../charts/Sparkline';
import { InfoTooltip } from '../ui/info-tooltip';

export type EnrichmentStats = Readonly<{
  pending: number;
  inProgress: number;
  completedToday: number;
  successRate: number;
  trendsData?: {
    pending?: number[];
    completed?: number[];
  };
}>;

export type EnrichmentStatsCardsProps = Readonly<{
  stats: EnrichmentStats;
}>;

export function EnrichmentStatsCards({ stats }: EnrichmentStatsCardsProps) {
  const pendingTrend = stats.trendsData?.pending ?? [];
  const completedTrend = stats.trendsData?.completed ?? [];
  const successPct = Math.min(Math.max(stats.successRate * 100, 0), 100);

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        <div className="mb-2 flex items-center justify-between text-xs text-warning">
          <span className="flex items-center gap-1.5">
            În așteptare
            <InfoTooltip title="În așteptare">
              Produsele în așteptare sunt cele care nu au fost încă procesate de pipeline. De ce
              contează: un număr mare indică un backlog care crește. Exemplu: 150 în așteptare = 150
              produse care nu au date îmbogățite. Sfat: pornește enrichment-ul manual dacă coada
              stagnează.
            </InfoTooltip>
          </span>
          {pendingTrend.length ? (
            <Sparkline data={pendingTrend} color="rgb(var(--color-warning))" />
          ) : null}
        </div>
        <div className="text-h5 text-foreground">{stats.pending}</div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-primary">
          <span>În curs</span>
          <InfoTooltip title="În curs">
            Produsele în curs sunt cele aflate activ în procesare (căutare, audit AI, scraping,
            extracție). De ce contează: arată cât de ocupat este pipeline-ul acum. Exemplu: 25 în
            curs înseamnă 25 produse procesate simultan. Sfat: dacă nu vezi nicio mișcare, verifică
            starea cozilor.
          </InfoTooltip>
        </div>
        <div className="text-h5 text-foreground">{stats.inProgress}</div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        <div className="mb-2 flex items-center justify-between text-xs text-success">
          <span className="flex items-center gap-1.5">
            Finalizate azi
            <InfoTooltip title="Finalizate azi">
              Finalizate azi arată câte produse au fost procesate cu succes în ziua curentă. De ce
              contează: reflectă productivitatea zilnică a pipeline-ului. Exemplu: 80 finalizate azi
              = 80 de produse au primit date noi. Sfat: compară cu trendul pentru a vedea dacă
              ritmul crește.
            </InfoTooltip>
          </span>
          {completedTrend.length ? (
            <Sparkline data={completedTrend} color="rgb(var(--color-success))" />
          ) : null}
        </div>
        <div className="text-h5 text-foreground">{stats.completedToday}</div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-primary">
          <span>Rata succes</span>
          <InfoTooltip title="Rata succes">
            Rata de succes este procentul produselor finalizate cu succes din totalul celor
            procesate. De ce contează: o rată scăzută indică probleme cu sursele sau pipeline-ul.
            Exemplu: 92% succes = 8 din 100 eșuează. Sfat: verifică sursele cu rată scăzută în
            tabelul de performanță.
          </InfoTooltip>
        </div>
        <div className="mt-2">
          <GaugeChart value={successPct} max={100} ariaLabel="Rata succes" />
        </div>
      </div>
    </div>
  );
}
