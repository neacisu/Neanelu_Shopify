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
  onPauseQueue?: () => void;
  onIncreaseBudget?: () => void;
}>;

export function BudgetAlertsPanel({
  budget,
  onPauseQueue,
  onIncreaseBudget,
}: BudgetAlertsPanelProps) {
  if (!budget) {
    return (
      <div className="rounded-lg border border-muted/20 bg-background p-4 text-sm text-muted">
        Bugetul nu este configurat în DB.
      </div>
    );
  }

  const percentage = Math.min(Math.max(budget.percentage * 100, 0), 100);
  const statusText =
    budget.status === 'critical'
      ? 'Budget limit reached'
      : budget.status === 'warning'
        ? 'Budget warning'
        : 'Budget healthy';
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

      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <GaugeChart value={percentage} max={100} {...(thresholds ? { thresholds } : {})} />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onPauseQueue}>
            Pause queue
          </Button>
          <Button size="sm" onClick={onIncreaseBudget}>
            Increase budget
          </Button>
        </div>
      </div>
    </div>
  );
}
