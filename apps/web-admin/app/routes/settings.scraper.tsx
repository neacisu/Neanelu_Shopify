import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, Cog, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import type {
  ScraperActivityDataPoint,
  ScraperConfigResponse,
  ScraperHealthResponse,
  ScraperQueueStatusResponse,
  ScraperRobotsTestResponse,
  ScraperRunResponse,
  ScraperSettingsResponse,
  ScraperSettingsUpdateRequest,
} from '@app/types';

import { SubmitButton } from '../components/forms/submit-button';
import { ConfirmDialog } from '../components/domain/confirm-dialog';
import { DataFreshnessIndicator } from '../components/domain/DataFreshnessIndicator';
import { GaugeChart } from '../components/charts/GaugeChart';
import { Sparkline } from '../components/charts/Sparkline';
import { DashboardSkeleton } from '../components/patterns/DashboardSkeleton';
import { EmptyState } from '../components/patterns/empty-state';
import { useApiClient } from '../hooks/use-api';
import { ScraperActivityChart } from '../components/domain/ScraperActivityChart';
import { ScraperDomainPerformanceTable } from '../components/domain/ScraperDomainPerformanceTable';
import { PolarisTooltip } from '../../components/polaris/tooltip';

type BrowserStatus = ScraperSettingsResponse['browserStatus'];
type RunStatus = ScraperRunResponse['status'];
type SortDirection = 'asc' | 'desc';
type ConfigSortKey = 'successRate' | 'lastRunAt';
type RunSortKey = 'startedAt' | 'durationMs' | 'status';

const STATUS_LABELS: Record<BrowserStatus, string> = {
  available: 'Disponibil',
  unavailable: 'Indisponibil',
  not_installed: 'Neinstalat',
  error: 'Eroare',
};
const STATUS_STYLES: Record<BrowserStatus, string> = {
  available: 'bg-success/15 text-success',
  unavailable: 'bg-error/15 text-error',
  not_installed: 'bg-warning/15 text-warning',
  error: 'bg-error/15 text-error',
};
const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  pending: 'bg-muted/20 text-muted',
  running: 'bg-blue-500/15 text-blue-600',
  completed: 'bg-success/15 text-success',
  failed: 'bg-error/15 text-error',
  cancelled: 'bg-muted/20 text-muted',
  deduped: 'bg-muted/20 text-muted',
};

export default function SettingsScraper() {
  const api = useApiClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [settings, setSettings] = useState<ScraperSettingsResponse | null>(null);
  const [configs, setConfigs] = useState<ScraperConfigResponse[]>([]);
  const [runs, setRuns] = useState<ScraperRunResponse[]>([]);
  const [activity, setActivity] = useState<ScraperActivityDataPoint[]>([]);
  const [queueStatus, setQueueStatus] = useState<ScraperQueueStatusResponse | null>(null);
  const [health, setHealth] = useState<ScraperHealthResponse | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [rateLimit, setRateLimit] = useState(1);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [maxPages, setMaxPages] = useState(5);
  const [userAgent, setUserAgent] = useState('NeaneluPIM/1.0');
  const [robotsTtl, setRobotsTtl] = useState(86400);

  const [robotsTestUrl, setRobotsTestUrl] = useState('');
  const [robotsResult, setRobotsResult] = useState<ScraperRobotsTestResponse | null>(null);
  const [robotsLoading, setRobotsLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [configSortKey, setConfigSortKey] = useState<ConfigSortKey>('successRate');
  const [configSortDirection, setConfigSortDirection] = useState<SortDirection>('desc');
  const [runSortKey, setRunSortKey] = useState<RunSortKey>('startedAt');
  const [runSortDirection, setRunSortDirection] = useState<SortDirection>('desc');
  const [deactivateConfigId, setDeactivateConfigId] = useState<string | null>(null);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);

  const loadAll = async (pageArg = page, limitArg = limit) => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, configsRes, runsRes, activityRes, queueRes] = await Promise.all([
        api.getApi<ScraperSettingsResponse>('/settings/scraper'),
        api.getApi<ScraperConfigResponse[]>('/settings/scraper/configs'),
        api.getApi<{ items: ScraperRunResponse[] }>(
          `/settings/scraper/runs?page=${String(pageArg)}&limit=${String(limitArg)}`
        ),
        api.getApi<ScraperActivityDataPoint[]>('/settings/scraper/activity?days=7'),
        api.getApi<ScraperQueueStatusResponse>('/settings/scraper/queue-status'),
      ]);
      setSettings(settingsRes);
      setConfigs(configsRes);
      setRuns(runsRes.items);
      setActivity(activityRes);
      setQueueStatus(queueRes);
      setEnabled(settingsRes.enabled);
      setRateLimit(settingsRes.rateLimitPerDomain);
      setTimeoutMs(settingsRes.timeoutMs);
      setMaxPages(settingsRes.maxConcurrentPages);
      setUserAgent(settingsRes.userAgent);
      setRobotsTtl(settingsRes.robotsCacheTtl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nu am putut incarca setarile scraper.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(false), 2000);
    return () => clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadAll();
    }, 120_000);
    return () => clearInterval(timer);
  }, [page, limit]);

  const configRows = useMemo(() => {
    const next = [...configs];
    next.sort((a, b) => {
      const left =
        configSortKey === 'successRate'
          ? Number(a.successRate ?? 0)
          : Date.parse(a.lastRunAt ?? '');
      const right =
        configSortKey === 'successRate'
          ? Number(b.successRate ?? 0)
          : Date.parse(b.lastRunAt ?? '');
      const diff = Number.isFinite(left) && Number.isFinite(right) ? left - right : 0;
      return configSortDirection === 'asc' ? diff : -diff;
    });
    return next;
  }, [configs, configSortDirection, configSortKey]);

  const runRows = useMemo(() => {
    const next = [...runs];
    next.sort((a, b) => {
      const left =
        runSortKey === 'startedAt'
          ? Date.parse(a.startedAt ?? '')
          : runSortKey === 'durationMs'
            ? Number(a.durationMs ?? 0)
            : a.status.localeCompare(b.status);
      const right =
        runSortKey === 'startedAt'
          ? Date.parse(b.startedAt ?? '')
          : runSortKey === 'durationMs'
            ? Number(b.durationMs ?? 0)
            : b.status.localeCompare(a.status);
      const diff = Number.isFinite(left) && Number.isFinite(right) ? left - right : 0;
      return runSortDirection === 'asc' ? diff : -diff;
    });
    return next;
  }, [runSortDirection, runSortKey, runs]);

  const submitState = useMemo(() => {
    if (saving) return 'loading';
    if (success) return 'success';
    if (error) return 'error';
    return 'idle';
  }, [error, saving, success]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: ScraperSettingsUpdateRequest = {
        enabled,
        rateLimitPerDomain: rateLimit,
        timeoutMs,
        maxConcurrentPages: maxPages,
        userAgent,
        robotsCacheTtl: robotsTtl,
      };
      await api.putApi<ScraperSettingsResponse, Record<string, unknown>>(
        '/settings/scraper',
        payload as Record<string, unknown>
      );
      setSuccess(true);
      toast.success('Setarile scraper au fost salvate.');
      await loadAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nu am putut salva setarile.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const runHealthCheck = async () => {
    setHealthLoading(true);
    try {
      const response = await api.getApi<ScraperHealthResponse>('/settings/scraper/health');
      setHealth(response);
      if (response.status === 'available') toast.success('Browser health check OK');
      else toast.error(response.message ?? 'Browser indisponibil');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Health check esuat');
    } finally {
      setHealthLoading(false);
    }
  };

  const runRobotsTest = async () => {
    if (!robotsTestUrl.trim()) return;
    setRobotsLoading(true);
    setRobotsResult(null);
    try {
      const response = await api.postApi<ScraperRobotsTestResponse, { url: string }>(
        '/settings/scraper/robots-test',
        { url: robotsTestUrl.trim() }
      );
      setRobotsResult(response);
      toast.success('Robots test finalizat');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Robots test esuat');
    } finally {
      setRobotsLoading(false);
    }
  };

  const deactivateConfig = async (id: string) => {
    try {
      await api.getApi(`/settings/scraper/configs/${id}`, { method: 'DELETE' });
      toast.success('Configuratia a fost dezactivata');
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut dezactiva configuratia');
    }
  };

  const purgeFailedQueue = async () => {
    try {
      await api.postApi('/settings/scraper/queue/purge-failed', {});
      toast.success('Elementele failed au fost sterse');
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut sterge failed queue');
    }
  };

  const retryFailedQueue = async () => {
    try {
      await api.postApi('/settings/scraper/queue/retry-failed', {});
      toast.success('Elementele failed au fost reprogramate');
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut face retry');
    }
  };

  if (loading) {
    return <DashboardSkeleton rows={2} columns={3} variant="kpi" />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-muted/20 bg-muted/5 p-4">
        <h3 className="font-medium text-body">Scraper fallback - Playwright + robots.txt</h3>
        <p className="mt-1 text-sm text-muted">
          Fallback pentru pagini JS-heavy. Respecta automat robots.txt si aplica rate limiting pe
          domeniu.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-muted/20 bg-background p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Status browser</span>
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              STATUS_STYLES[settings?.browserStatus ?? 'error']
            }`}
          >
            {STATUS_LABELS[settings?.browserStatus ?? 'error']}
          </span>
          {health?.checkedAt ? (
            <span>verificat {new Date(health.checkedAt).toLocaleString()}</span>
          ) : null}
        </div>
      </div>

      {settings ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-muted/20 bg-background p-4">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Pages azi</span>
                <Sparkline data={settings.weekTrends.pagesScraped} color="#2563eb" />
              </div>
              <div className="text-h5">{settings.todayStats.pagesScraped}</div>
            </div>
            <div className="rounded-lg border border-muted/20 bg-background p-4">
              <div className="text-xs text-muted">Success rate</div>
              <div className="mt-2">
                <GaugeChart
                  value={Math.round(settings.todayStats.successRate * 100)}
                  max={100}
                  ariaLabel="Success rate scraper"
                />
              </div>
            </div>
            <div className="rounded-lg border border-muted/20 bg-background p-4">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Avg latency</span>
                <Sparkline data={settings.weekTrends.failed} color="#f59e0b" />
              </div>
              <div className="text-h5">{settings.todayStats.avgLatencyMs.toFixed(0)}ms</div>
            </div>
            <div className="rounded-lg border border-muted/20 bg-background p-4">
              <div className="text-xs text-muted">Cheerio fast path</div>
              <div className="text-h5">
                {settings.todayStats.cheerioFastPath}
                <span className="ml-2 rounded-full bg-success/15 px-2 py-1 text-xs text-success">
                  Fast
                </span>
              </div>
            </div>
          </div>
          <DataFreshnessIndicator refreshedAt={settings.refreshedAt} label="Scraper data" />
        </>
      ) : null}

      <ScraperActivityChart data={activity} />

      <form
        onSubmit={(event) => void onSubmit(event)}
        className="space-y-4 rounded-lg border border-muted/20 bg-background p-4"
      >
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Activeaza scraper fallback
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Rate limit per domain
              <PolarisTooltip content="Numarul maxim de requesturi pe secunda catre un singur domeniu">
                <span className="cursor-help text-xs text-muted">?</span>
              </PolarisTooltip>
            </span>
            <input
              type="number"
              min={1}
              max={5}
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Timeout (ms)
              <PolarisTooltip content="Timpul maxim de asteptare pentru incarcarea paginii">
                <span className="cursor-help text-xs text-muted">?</span>
              </PolarisTooltip>
            </span>
            <input
              type="number"
              min={10000}
              max={120000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Max concurrent pages
              <PolarisTooltip content="Numarul maxim de pagini Chromium deschise simultan">
                <span className="cursor-help text-xs text-muted">?</span>
              </PolarisTooltip>
            </span>
            <input
              type="number"
              min={1}
              max={10}
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Robots cache TTL (sec)
              <PolarisTooltip content="Cat timp se pastreaza cache-ul robots.txt">
                <span className="cursor-help text-xs text-muted">?</span>
              </PolarisTooltip>
            </span>
            <input
              type="number"
              min={60}
              max={604800}
              value={robotsTtl}
              onChange={(e) => setRobotsTtl(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
            />
          </label>
        </div>

        <label className="space-y-1 text-sm block">
          <span className="text-muted">User-Agent</span>
          <input
            type="text"
            value={userAgent}
            onChange={(e) => setUserAgent(e.target.value)}
            className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
          />
        </label>

        <div className="rounded-md border border-muted/20 bg-muted/5 p-3 text-xs text-muted inline-flex items-center gap-1">
          robots.txt respect: <span className="font-medium text-success">Always ON</span> (RFC 9309)
          <PolarisTooltip content="Conform RFC 9309, nu se poate dezactiva">
            <span className="cursor-help text-xs text-muted">?</span>
          </PolarisTooltip>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState}>Salveaza setari scraper</SubmitButton>
          <button
            type="button"
            onClick={() => void runHealthCheck()}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:opacity-50"
            disabled={healthLoading}
          >
            {healthLoading ? 'Se testeaza...' : 'Test Browser'}
          </button>
          <button
            type="button"
            onClick={() => setDisableConfirmOpen(true)}
            className="rounded-md border border-error/40 px-4 py-2 text-sm font-medium text-error shadow-sm hover:bg-error/5"
          >
            Deconecteaza
          </button>
          {health ? (
            <span
              className={`text-xs ${health.status === 'available' ? 'text-success' : 'text-error'}`}
            >
              {health.status === 'available'
                ? `Chromium ${health.chromiumVersion ?? '-'} (${health.launchTimeMs ?? 0}ms)`
                : (health.message ?? 'Browser indisponibil')}
            </span>
          ) : null}
        </div>
      </form>

      <div className="rounded-lg border border-muted/20 bg-background p-4 space-y-3">
        <div className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Robots.txt URL tester
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={robotsTestUrl}
            onChange={(event) => setRobotsTestUrl(event.target.value)}
            placeholder="https://example.com/product-page"
            className="min-w-[280px] flex-1 rounded-md border border-muted/20 bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void runRobotsTest()}
            disabled={robotsLoading || !robotsTestUrl.trim()}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:opacity-50"
          >
            {robotsLoading ? 'Testing...' : 'Test robots.txt'}
          </button>
        </div>
        {robotsResult ? (
          <div
            className={`rounded-md border p-3 text-sm ${robotsResult.allowed ? 'border-success/30 bg-success/10 text-success' : 'border-error/30 bg-error/10 text-error'}`}
          >
            {robotsResult.allowed ? 'Allowed' : 'Blocked'} - {robotsResult.domain} (
            {robotsResult.robotsTxtCached ? 'cached' : 'fresh'})
          </div>
        ) : null}
      </div>

      <ScraperDomainPerformanceTable rows={settings?.domainPerformance ?? []} />

      <div className="rounded-lg border border-muted/20 bg-background p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Scraper queue status</div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-muted/20 px-3 py-1 text-xs"
              onClick={() => setPurgeConfirmOpen(true)}
            >
              Purge Failed
            </button>
            <button
              type="button"
              className="rounded-md border border-muted/20 px-3 py-1 text-xs"
              onClick={() => void retryFailedQueue()}
            >
              Retry All Failed
            </button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-4 text-sm">
          <div className="rounded border border-muted/20 p-3">
            Pending: {queueStatus?.pending ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3">
            Processing: {queueStatus?.processing ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3">
            Completed: {queueStatus?.completed ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3">
            Failed: {queueStatus?.failed ?? 0}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="mb-2 text-xs text-muted">Active scraper configs</div>
        {!configRows.length ? (
          <EmptyState
            icon={Cog}
            title="Nicio configuratie scraper"
            description="Adauga o configuratie noua pentru un domeniu."
            actionLabel="Adauga config"
            onAction={() => toast.info('Endpointul de creare este disponibil in API.')}
          />
        ) : (
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/20">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">URL Pattern</th>
                  <th className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (configSortKey === 'successRate')
                          setConfigSortDirection(configSortDirection === 'asc' ? 'desc' : 'asc');
                        else {
                          setConfigSortKey('successRate');
                          setConfigSortDirection('desc');
                        }
                      }}
                    >
                      Success Rate
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (configSortKey === 'lastRunAt')
                          setConfigSortDirection(configSortDirection === 'asc' ? 'desc' : 'asc');
                        else {
                          setConfigSortKey('lastRunAt');
                          setConfigSortDirection('desc');
                        }
                      }}
                    >
                      Last Run
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {configRows.map((config) => (
                  <tr key={config.id} className="border-t border-muted/20">
                    <td className="px-3 py-2">{config.name}</td>
                    <td className="px-3 py-2">{config.sourceName ?? '-'}</td>
                    <td className="px-3 py-2">{config.scraperType}</td>
                    <td className="px-3 py-2">{config.targetUrlPattern}</td>
                    <td className="px-3 py-2 text-right">
                      {config.successRate != null ? `${config.successRate.toFixed(1)}%` : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {config.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-error text-xs"
                        onClick={() => setDeactivateConfigId(config.id)}
                      >
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted">Recent runs</div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className="rounded border border-muted/20 px-2 py-1"
              disabled={page <= 1}
              onClick={() => {
                const next = Math.max(1, page - 1);
                setPage(next);
                void loadAll(next, limit);
              }}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              type="button"
              className="rounded border border-muted/20 px-2 py-1"
              onClick={() => {
                const next = page + 1;
                setPage(next);
                void loadAll(next, limit);
              }}
            >
              Next
            </button>
            <select
              value={limit}
              onChange={(e) => {
                const nextLimit = Number(e.target.value);
                setLimit(nextLimit);
                setPage(1);
                void loadAll(1, nextLimit);
              }}
              className="rounded border border-muted/20 bg-background px-2 py-1"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {!runRows.length ? (
          <EmptyState
            icon={Activity}
            title="Niciun run inregistrat"
            description="Runs vor aparea dupa primele executii scraper."
          />
        ) : (
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/20">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => {
                        if (runSortKey === 'startedAt')
                          setRunSortDirection(runSortDirection === 'asc' ? 'desc' : 'asc');
                        else {
                          setRunSortKey('startedAt');
                          setRunSortDirection('desc');
                        }
                      }}
                    >
                      Started At
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">Config</th>
                  <th className="px-3 py-2 text-left">Method</th>
                  <th className="px-3 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => {
                        if (runSortKey === 'status')
                          setRunSortDirection(runSortDirection === 'asc' ? 'desc' : 'asc');
                        else {
                          setRunSortKey('status');
                          setRunSortDirection('desc');
                        }
                      }}
                    >
                      Status
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right">Pages</th>
                  <th className="px-3 py-2 text-right">Products</th>
                  <th className="px-3 py-2 text-right">Errors</th>
                  <th className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (runSortKey === 'durationMs')
                          setRunSortDirection(runSortDirection === 'asc' ? 'desc' : 'asc');
                        else {
                          setRunSortKey('durationMs');
                          setRunSortDirection('desc');
                        }
                      }}
                    >
                      Duration
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {runRows.map((run) => (
                  <tr key={run.id} className="border-t border-muted/20">
                    <td className="px-3 py-2">
                      {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-3 py-2">{run.configName ?? run.configId}</td>
                    <td className="px-3 py-2">
                      {run.method === 'cheerio' ? (
                        <span className="rounded-full bg-success/15 px-2 py-1 text-xs text-success">
                          Fast
                        </span>
                      ) : (
                        <span className="rounded-full bg-warning/15 px-2 py-1 text-xs text-warning">
                          Full Render
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${RUN_STATUS_STYLES[run.status]}`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{run.pagesCrawled}</td>
                    <td className="px-3 py-2 text-right">{run.productsFound}</td>
                    <td className="px-3 py-2 text-right">{run.errorsCount}</td>
                    <td className="px-3 py-2 text-right">
                      {run.durationMs != null ? `${run.durationMs}ms` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deactivateConfigId != null}
        title="Dezactivezi configuratia?"
        message="Configuratia nu va mai fi folosita pentru matching."
        confirmLabel="Dezactiveaza"
        cancelLabel="Renunta"
        confirmTone="critical"
        onCancel={() => setDeactivateConfigId(null)}
        onConfirm={() => {
          if (deactivateConfigId) void deactivateConfig(deactivateConfigId);
          setDeactivateConfigId(null);
        }}
      />

      <ConfirmDialog
        open={disableConfirmOpen}
        title="Dezactivezi scraper fallback?"
        message="Playwright fallback va fi oprit pana la reactivare."
        confirmLabel="Dezactiveaza"
        cancelLabel="Renunta"
        confirmTone="critical"
        onCancel={() => setDisableConfirmOpen(false)}
        onConfirm={() => {
          setEnabled(false);
          setDisableConfirmOpen(false);
          toast.info('Scraper va fi dezactivat dupa salvare.');
        }}
      />

      <ConfirmDialog
        open={purgeConfirmOpen}
        title="Stergi toate elementele failed?"
        message="Actiunea curata doar itemii failed din scraper queue."
        confirmLabel="Purge failed"
        cancelLabel="Renunta"
        confirmTone="critical"
        onCancel={() => setPurgeConfirmOpen(false)}
        onConfirm={() => {
          void purgeFailedQueue();
          setPurgeConfirmOpen(false);
        }}
      />
    </div>
  );
}
