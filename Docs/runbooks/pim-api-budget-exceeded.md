# PIM API Budget Exceeded Runbook

## Scope

This runbook covers incidents where external API budgets (Serper, xAI, OpenAI) reach warning or critical thresholds and may pause enrichment processing.

## Symptoms

- Alert `PimApiBudgetWarning` or `PimApiBudgetExceeded` fires in Prometheus.
- `pim_api_budget_usage_ratio` for one provider is `>= 0.8` (warning) or `>= 1.0` (critical).
- Enrichment queue is paused (`PimEnrichmentQueuePausedTooLong` alert).
- PIM cost dashboard shows high daily ratio and reduced throughput.

## Impact

- New enrichment jobs can be delayed or blocked.
- External enrichment quality can degrade while queue is paused.
- Weekly summaries and cost per golden record can regress.

## Immediate Actions

1. Identify affected provider (`serper`, `xai`, `openai`) from alert labels.
2. Open `/pim/stats/cost-tracking/budget-status` and confirm exceeded ratio.
3. Pause manual triggers and bulk enrichment from admin UI to reduce further spend.
4. If necessary, increase provider budgets via `PUT /pim/stats/cost-tracking/budgets`.
5. Resume enrichment queue only after budgets/limits are safely adjusted.

## Diagnosis Checklist

- Confirm whether spike is real:
  - `increase(pim_api_cost_total[1h])`
  - `increase(pim_api_requests_total[1h])`
  - `increase(pim_api_errors_total[1h])`
- Check for retries/storms:
  - queue retries and failed jobs
  - high external API latency
- Validate provider health and credentials:
  - Serper/xAI/OpenAI health workers
  - API key validity and quota on provider side

## Recovery Steps

1. Fix root cause (retry storm, misconfiguration, unusual volume).
2. Update budget limits and/or thresholds per provider.
3. Clear stale budget cache key:
   - `pim:budget:max_ratios`
4. Resume enrichment queue (`/pim/stats/cost-tracking/resume-enrichment`).
5. Monitor for 30 minutes:
   - budget ratio trend
   - error rate
   - queue depth and throughput

## Post-Incident

- Document incident timeline and total additional spend.
- Add guardrails if needed:
  - lower concurrency,
  - stricter throttling,
  - tighter alert windows.
- Validate next weekly summary notification.
