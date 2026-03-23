import { AlertTriangle } from 'lucide-react';
import { GaugeChart } from '../charts/GaugeChart';
import { Button } from '../ui/button';

type ProviderKey = 'serper' | 'xai' | 'openai' | 'scraper';
type ProviderStatus = 'critical' | 'warning' | 'ok';

function providerDisplayName(provider: ProviderKey): string {
  const names: Record<ProviderKey, string> = {
    serper: 'Serper',
    xai: 'xAI',
    scraper: 'Scraper',
    openai: 'OpenAI',
  };
  return names[provider];
}

function resolveProviderStatus(exceeded: boolean, alertTriggered: boolean): ProviderStatus {
  if (exceeded) return 'critical';
  if (alertTriggered) return 'warning';
  return 'ok';
}

function providerStatusClass(status: ProviderStatus): string {
  if (status === 'critical') return 'text-error';
  if (status === 'warning') return 'text-warning';
  return 'text-success';
}

function providerStatusLabel(status: ProviderStatus): string {
  if (status === 'critical') return 'Depasit';
  if (status === 'warning') return 'Atentie';
  return 'In regula';
}

function resolveBudgetStatusText(status: BudgetStatus): string {
  if (status === 'critical') return 'Limita buget depasita';
  if (status === 'warning') return 'Avertizare buget';
  return 'Buget in parametri';
}

export type BudgetStatus = 'ok' | 'warning' | 'critical' | null;

export type BudgetSnapshot = Readonly<{
  daily: number;
  used: number;
  percentage: number;
  status: BudgetStatus;
  warningThreshold: number | null;
  criticalThreshold: number | null;
}>;

export type BudgetAlertsPanelProps = Readonly<{
  budget: BudgetSnapshot | null;
  providers?: readonly {
    provider: 'serper' | 'xai' | 'openai' | 'scraper';
    primary: {
      unit: 'requests' | 'dollars' | 'items';
      used: number;
      limit: number;
      remaining?: number;
      ratio: number;
    };
    secondary?: {
      unit: 'items';
      used: number;
      limit: number;
      remaining?: number;
      ratio: number;
    };
    alertThreshold: number;
    exceeded: boolean;
    alertTriggered: boolean;
  }[];
  onPauseQueue?: () => void;
  onResumeQueue?: () => void;
  onPauseAllQueues?: () => void;
  onResumeAllQueues?: () => void;
  onIncreaseBudget?: () => void;
  actionsDisabled?: boolean;
}>;

export function BudgetAlertsPanel({
  budget,
  providers = [],
  onPauseQueue,
  onResumeQueue,
  onPauseAllQueues,
  onResumeAllQueues,
  onIncreaseBudget,
  actionsDisabled = false,
}: BudgetAlertsPanelProps) {
  if (!budget) {
    return (
      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 text-sm text-muted">
        Bugetul nu este configurat in baza de date.
      </div>
    );
  }

  const percentage = Math.min(Math.max(budget.percentage * 100, 0), 100);
  const statusText = resolveBudgetStatusText(budget.status);
  const thresholds =
    budget.warningThreshold != null && budget.criticalThreshold != null
      ? [
          { value: budget.warningThreshold * 100, color: 'rgb(var(--color-warning))' },
          { value: budget.criticalThreshold * 100, color: 'rgb(var(--color-error))' },
        ]
      : undefined;

  return (
    <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-(--shadow-md)">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {statusText}
        </div>
        <div className="text-xs text-muted">
          {budget.used.toFixed(2)} / {budget.daily.toFixed(2)}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <GaugeChart
            value={percentage}
            max={100}
            ariaLabel={`Buget total utilizat ${Math.round(percentage)} procente`}
            {...(thresholds ? { thresholds } : {})}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              size="sm"
              onClick={onPauseQueue}
              disabled={actionsDisabled}
              title="Pauzează coada de enrichment"
            >
              Pauzează coada
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onResumeQueue}
              disabled={actionsDisabled}
              title="Reia coada de enrichment"
            >
              Reia coada
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onPauseAllQueues}
              disabled={actionsDisabled}
              title="Pauzează toate cozile cost-sensitive"
            >
              Pauzează toate cozile
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onResumeAllQueues}
              disabled={actionsDisabled}
              title="Reia toate cozile cost-sensitive"
            >
              Reia toate cozile
            </Button>
            <Button
              size="sm"
              onClick={onIncreaseBudget}
              disabled={actionsDisabled}
              title="Editează limitele zilnice și pragurile de alertă"
            >
              Editează bugete
            </Button>
          </div>
        </div>

        {providers.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {providers.map((provider) => {
              const providerLabel = providerDisplayName(provider.provider);
              const providerStatus = resolveProviderStatus(
                provider.exceeded,
                provider.alertTriggered
              );
              const statusClass = providerStatusClass(providerStatus);
              const statusLabel = providerStatusLabel(providerStatus);
              const providerThresholds = [
                { value: provider.alertThreshold * 100, color: 'rgb(var(--color-warning))' },
                { value: 100, color: 'rgb(var(--color-error))' },
              ];
              return (
                <div
                  key={provider.provider}
                  className="rounded border border-muted/20 bg-card/50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between text-xs text-foreground">
                    <span>{providerLabel}</span>
                    <span className="text-muted">
                      {provider.primary.used > 0
                        ? `${provider.primary.used.toFixed(2)} / ${provider.primary.limit.toFixed(2)}`
                        : 'Nicio utilizare astazi'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <GaugeChart
                      value={Math.min(Math.max(provider.primary.ratio * 100, 0), 100)}
                      max={100}
                      thresholds={providerThresholds}
                      label={provider.primary.unit}
                      ariaLabel={`${providerLabel} utilizare ${Math.round(provider.primary.ratio * 100)} procente`}
                    />
                    <span className={`text-xs ${statusClass}`}>{statusLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
