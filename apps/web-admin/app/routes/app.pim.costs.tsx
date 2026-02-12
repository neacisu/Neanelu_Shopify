import type { ActionFunction, ActionFunctionArgs, LoaderFunctionArgs } from 'react-router-dom';
import { data, useFetcher, useLoaderData, useNavigation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { DollarSign, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { BudgetAlertsPanel } from '../components/domain/BudgetAlertsPanel';
import { BudgetEditModal } from '../components/domain/BudgetEditModal';
import { ConfirmDialog } from '../components/domain/confirm-dialog';
import { CostBreakdownChart } from '../components/domain/CostBreakdownChart';
import { ProviderComparisonTable } from '../components/domain/ProviderComparisonTable';
import { LoadingState } from '../components/patterns/loading-state';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';
import { apiAction, createActionApiClient } from '../utils/actions';

interface CostTrackingResponse {
  today: { serper: number; xai: number; openai: number; total: number };
  thisWeek: { serper: number; xai: number; openai: number; total: number };
  thisMonth: { serper: number; xai: number; openai: number; total: number };
  budget: {
    daily: number;
    used: number;
    percentage: number;
    status: 'ok' | 'warning' | 'critical' | null;
    warningThreshold: number | null;
    criticalThreshold: number | null;
  } | null;
  costPerGolden: { current: number | null; target: number | null; trend: number | null };
  breakdown: {
    date: string;
    search: number;
    audit: number;
    extraction: number;
    embedding: number;
  }[];
  breakdownRange: { from: string; to: string } | null;
}

type BudgetStatusResponse = Readonly<{
  providers: {
    provider: 'serper' | 'xai' | 'openai';
    primary: {
      unit: 'requests' | 'dollars' | 'items';
      used: number;
      limit: number;
      remaining: number;
      ratio: number;
    };
    secondary?: {
      unit: 'items';
      used: number;
      limit: number;
      remaining: number;
      ratio: number;
    };
    alertThreshold: number;
    exceeded: boolean;
    alertTriggered: boolean;
  }[];
}>;

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  return {
    costs: await api.getApi<CostTrackingResponse>('/pim/stats/cost-tracking'),
    budgetStatus: await api.getApi<BudgetStatusResponse>('/pim/stats/cost-tracking/budget-status'),
  };
});

type CostActionIntent = 'pause-enrichment' | 'resume-enrichment' | 'update-budgets';
type CostActionResult =
  | {
      ok: true;
      intent: CostActionIntent;
      toast?: { type: 'success' | 'error'; message: string };
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

export const action: ActionFunction = apiAction(async (args: ActionFunctionArgs) => {
  const api = createActionApiClient();
  const formData = await args.request.formData();
  const intentRaw = formData.get('intent');
  const intent = (typeof intentRaw === 'string' ? intentRaw : '') as CostActionIntent;

  if (!intent) {
    return data(
      {
        ok: false,
        error: { code: 'missing_intent', message: 'Missing intent' },
      } satisfies CostActionResult,
      {
        status: 400,
      }
    );
  }

  if (intent === 'pause-enrichment') {
    await api.postApi('/pim/stats/cost-tracking/pause-enrichment', {});
    return data({
      ok: true,
      intent,
      toast: { type: 'success', message: 'Enrichment queue paused' },
    } satisfies CostActionResult);
  }

  if (intent === 'resume-enrichment') {
    await api.postApi('/pim/stats/cost-tracking/resume-enrichment', {});
    return data({
      ok: true,
      intent,
      toast: { type: 'success', message: 'Enrichment queue resumed' },
    } satisfies CostActionResult);
  }

  const payload: Record<string, number> = {};
  const numericKeys = [
    'serperDailyBudget',
    'serperBudgetAlertThreshold',
    'xaiDailyBudget',
    'xaiBudgetAlertThreshold',
    'openaiDailyBudget',
    'openaiBudgetAlertThreshold',
    'openaiItemsDailyBudget',
  ] as const;
  for (const key of numericKeys) {
    const raw = formData.get(key);
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) payload[key] = parsed;
    }
  }
  await api.putApi('/pim/stats/cost-tracking/budgets', payload);
  return data({
    ok: true,
    intent,
    toast: { type: 'success', message: 'Budgets updated successfully' },
  } satisfies CostActionResult);
});

type RouteLoaderData = LoaderData<typeof loader>;

export default function CostTrackingPage() {
  const { costs, budgetStatus } = useLoaderData<RouteLoaderData>();
  const navigation = useNavigation();
  const fetcher = useFetcher<CostActionResult>();
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const trendValue = costs.costPerGolden.trend;
  const trendDirection = trendValue != null && trendValue >= 0 ? 'up' : 'down';
  const trendLabel = trendValue != null ? `${Math.abs(trendValue).toFixed(1)}%` : null;
  const usd = useMemo(
    () =>
      new Intl.NumberFormat('ro-RO', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }),
    []
  );
  const isSubmitting = fetcher.state === 'submitting';
  const isPageLoading = navigation.state === 'loading';
  const budgetFormInitialValues = useMemo(() => {
    const initial: {
      serperDailyBudget?: number;
      serperBudgetAlertThreshold?: number;
      xaiDailyBudget?: number;
      xaiBudgetAlertThreshold?: number;
      openaiDailyBudget?: number;
      openaiBudgetAlertThreshold?: number;
      openaiItemsDailyBudget?: number;
    } = {};
    for (const provider of budgetStatus.providers) {
      if (provider.provider === 'serper') {
        initial.serperDailyBudget = provider.primary.limit;
        initial.serperBudgetAlertThreshold = provider.alertThreshold;
      }
      if (provider.provider === 'xai') {
        initial.xaiDailyBudget = provider.primary.limit;
        initial.xaiBudgetAlertThreshold = provider.alertThreshold;
      }
      if (provider.provider === 'openai') {
        initial.openaiDailyBudget = provider.primary.limit;
        initial.openaiBudgetAlertThreshold = provider.alertThreshold;
        if (provider.secondary?.limit != null)
          initial.openaiItemsDailyBudget = provider.secondary.limit;
      }
    }
    return initial;
  }, [budgetStatus.providers]);

  useEffect(() => {
    const actionData = fetcher.data;
    if (!actionData) return;
    if (actionData.ok && actionData.toast) {
      const message = actionData.toast.message;
      if (actionData.toast.type === 'success') toast.success(message);
      else toast.error(message);
      if (actionData.intent === 'update-budgets') setBudgetModalOpen(false);
    }
    if (!actionData.ok) {
      toast.error(actionData.error.message);
    }
  }, [fetcher.data]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'PIM', href: '/pim/costs' },
          { label: 'Cost Tracking' },
        ]}
      />

      <PageHeader
        title="API Cost Management"
        description="Monitorizează costurile Serper/xAI/OpenAI și bugetele zilnice."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setBudgetModalOpen(true)}
            disabled={isSubmitting}
          >
            <DollarSign className="mr-2 h-4 w-4" />
            Setari buget
          </Button>
        }
      />

      <BudgetAlertsPanel
        budget={costs.budget}
        providers={budgetStatus.providers}
        onPauseQueue={() => setPauseConfirmOpen(true)}
        onResumeQueue={() => {
          const form = new FormData();
          form.set('intent', 'resume-enrichment');
          void fetcher.submit(form, { method: 'post' });
        }}
        onIncreaseBudget={() => setBudgetModalOpen(true)}
        actionsDisabled={isSubmitting}
      />

      {isPageLoading ? <LoadingState label="Se reincarca datele de cost..." /> : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <CostBreakdownChart data={costs.breakdown} />

        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Cost per Golden Record</div>
          <div className="text-h3">
            {costs.costPerGolden.current != null ? usd.format(costs.costPerGolden.current) : 'N/A'}
          </div>
          <div className="text-xs text-muted">
            Target:{' '}
            {costs.costPerGolden.target != null ? usd.format(costs.costPerGolden.target) : 'N/A'}
          </div>
          {trendLabel ? (
            <div
              className={`mt-2 inline-flex items-center gap-1 text-xs ${
                trendDirection === 'up' ? 'text-emerald-500' : 'text-red-500'
              }`}
            >
              {trendDirection === 'up' ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {trendLabel} vs periodă anterioară
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted">Date insuficiente pentru trend</div>
          )}
        </div>
      </div>

      <ProviderComparisonTable
        today={costs.today}
        thisWeek={costs.thisWeek}
        thisMonth={costs.thisMonth}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Astazi</div>
          <div className="text-h5">{usd.format(costs.today.total)}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Saptamana curenta</div>
          <div className="text-h5">{usd.format(costs.thisWeek.total)}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Luna curenta</div>
          <div className="text-h5">{usd.format(costs.thisMonth.total)}</div>
        </div>
      </div>

      <BudgetEditModal
        open={budgetModalOpen}
        initialValues={budgetFormInitialValues}
        isSubmitting={isSubmitting}
        onClose={() => setBudgetModalOpen(false)}
        onSubmit={(values) => {
          const form = new FormData();
          form.set('intent', 'update-budgets');
          Object.entries(values).forEach(([key, value]) => {
            if (value != null) form.set(key, String(value));
          });
          void fetcher.submit(form, { method: 'put' });
        }}
      />
      <ConfirmDialog
        open={pauseConfirmOpen}
        title="Pauzezi coada de enrichment?"
        message="Actiunea opreste temporar procesarea automata. O poti relua ulterior din dashboard."
        confirmLabel="Pauzeaza"
        cancelLabel="Renunta"
        confirmTone="critical"
        confirmLoading={isSubmitting}
        onCancel={() => setPauseConfirmOpen(false)}
        onConfirm={() => {
          const form = new FormData();
          form.set('intent', 'pause-enrichment');
          void fetcher.submit(form, { method: 'post' });
          setPauseConfirmOpen(false);
        }}
      />
    </div>
  );
}
