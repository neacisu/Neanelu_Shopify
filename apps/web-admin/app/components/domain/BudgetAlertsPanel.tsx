import { AlertTriangle } from 'lucide-react';
import { GaugeChart } from '../charts/GaugeChart';
import { Button } from '../ui/button';

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
    provider: 'serper' | 'xai' | 'openai';
    primary: {
      unit: 'requests' | 'dollars' | 'items';
      used: number;
      limit: number;
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
      <div className="rounded-lg border border-muted/20 bg-background p-4 text-sm text-muted">
        Bugetul nu este configurat in baza de date.
      </div>
    );
  }

  const percentage = Math.min(Math.max(budget.percentage * 100, 0), 100);
  const statusText =
    budget.status === 'critical'
      ? 'Limita buget depasita'
      : budget.status === 'warning'
        ? 'Avertizare buget'
        : 'Buget in parametri';
  const thresholds =
    budget.warningThreshold != null && budget.criticalThreshold != null
      ? [
          { value: budget.warningThreshold * 100, color: '#ffc453' },
          { value: budget.criticalThreshold * 100, color: '#d72c0d' },
        ]
      : undefined;

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
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
            <Button variant="secondary" size="sm" onClick={onPauseQueue} disabled={actionsDisabled}>
              Pauzeaza coada
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onResumeQueue}
              disabled={actionsDisabled}
            >
              Reia coada
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onPauseAllQueues}
              disabled={actionsDisabled}
            >
              Pauzeaza toate cozile
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onResumeAllQueues}
              disabled={actionsDisabled}
            >
              Reia toate cozile
            </Button>
            <Button size="sm" onClick={onIncreaseBudget} disabled={actionsDisabled}>
              Editeaza bugete
            </Button>
          </div>
        </div>

        {providers.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {providers.map((provider) => {
              const providerLabel =
                provider.provider === 'serper'
                  ? 'Serper'
                  : provider.provider === 'xai'
                    ? 'xAI'
                    : 'OpenAI';
              const providerStatus = provider.exceeded
                ? 'critical'
                : provider.alertTriggered
                  ? 'warning'
                  : 'ok';
              const providerThresholds = [
                { value: provider.alertThreshold * 100, color: '#ffc453' },
                { value: 100, color: '#d72c0d' },
              ];
              return (
                <div
                  key={provider.provider}
                  className="rounded border border-muted/20 bg-background/50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between text-xs">
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
                    <span
                      className={`text-xs ${
                        providerStatus === 'critical'
                          ? 'text-red-500'
                          : providerStatus === 'warning'
                            ? 'text-amber-500'
                            : 'text-emerald-500'
                      }`}
                    >
                      {providerStatus === 'critical'
                        ? 'Depasit'
                        : providerStatus === 'warning'
                          ? 'Atentie'
                          : 'In regula'}
                    </span>
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
