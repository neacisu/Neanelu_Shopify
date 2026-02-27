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
import { InfoTooltip } from '../components/ui/info-tooltip';
import { PolarisModal } from '../../components/polaris/index.js';

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
  available: 'bg-success/15 text-success dark:bg-emerald-900/30 dark:text-emerald-400',
  unavailable: 'bg-error/15 text-error dark:bg-red-900/30 dark:text-red-400',
  not_installed: 'bg-warning/15 text-warning dark:bg-amber-900/30 dark:text-amber-400',
  error: 'bg-error/15 text-error dark:bg-red-900/30 dark:text-red-400',
};
const RUN_STATUS_STYLES: Record<RunStatus, string> = {
  pending: 'bg-muted/20 text-muted dark:bg-slate-700/30 dark:text-slate-400',
  running: 'bg-blue-500/15 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-success/15 text-success dark:bg-emerald-900/30 dark:text-emerald-400',
  failed: 'bg-error/15 text-error dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-muted/20 text-muted dark:bg-slate-700/30 dark:text-slate-400',
  deduped: 'bg-muted/20 text-muted dark:bg-slate-700/30 dark:text-slate-400',
};
const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  pending: 'În așteptare',
  running: 'În curs',
  completed: 'Finalizat',
  failed: 'Eșuat',
  cancelled: 'Anulat',
  deduped: 'Deduplicat',
};

export default function SettingsScraper() {
  const api = useApiClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [settings, setSettings] = useState<ScraperSettingsResponse | null>(null);
  const [configs, setConfigs] = useState<ScraperConfigResponse[]>([]);
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
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

  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configEditingId, setConfigEditingId] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configDraft, setConfigDraft] = useState<{
    sourceId: string;
    name: string;
    scraperType: ScraperConfigResponse['scraperType'];
    targetUrlPattern: string;
    isActive: boolean;
  }>({
    sourceId: '',
    name: '',
    scraperType: 'PLAYWRIGHT',
    targetUrlPattern: '',
    isActive: true,
  });

  const loadAll = async (pageArg = page, limitArg = limit) => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, configsRes, sourcesRes, runsRes, activityRes, queueRes] =
        await Promise.all([
          api.getApi<ScraperSettingsResponse>('/settings/scraper'),
          api.getApi<ScraperConfigResponse[]>('/settings/scraper/configs'),
          api.getApi<{ sources: { id: string; name: string }[] }>('/settings/scraper/sources'),
          api.getApi<{ items: ScraperRunResponse[] }>(
            `/settings/scraper/runs?page=${String(pageArg)}&limit=${String(limitArg)}`
          ),
          api.getApi<ScraperActivityDataPoint[]>('/settings/scraper/activity?days=7'),
          api.getApi<ScraperQueueStatusResponse>('/settings/scraper/queue-status'),
        ]);
      setSettings(settingsRes);
      setConfigs(configsRes);
      setSources(sourcesRes.sources ?? []);
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
      const message = err instanceof Error ? err.message : 'Nu am putut încărca setările scraper.';
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
      toast.success('Setările scraper au fost salvate.');
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
      if (response.status === 'available') toast.success('Verificare browser reușită');
      else toast.error(response.message ?? 'Browser indisponibil');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verificare browser eșuată');
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
      toast.success('Test robots.txt finalizat');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test robots.txt eșuat');
    } finally {
      setRobotsLoading(false);
    }
  };

  const deactivateConfig = async (id: string) => {
    try {
      await api.getApi(`/settings/scraper/configs/${id}`, { method: 'DELETE' });
      toast.success('Configurația a fost dezactivată');
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut dezactiva configurația');
    }
  };

  const openCreateConfig = () => {
    setConfigEditingId(null);
    setConfigDraft({
      sourceId: sources[0]?.id ?? '',
      name: '',
      scraperType: 'PLAYWRIGHT',
      targetUrlPattern: '',
      isActive: true,
    });
    setConfigModalOpen(true);
  };

  const openEditConfig = (config: ScraperConfigResponse) => {
    setConfigEditingId(config.id);
    setConfigDraft({
      sourceId: config.sourceId,
      name: config.name,
      scraperType: config.scraperType,
      targetUrlPattern: config.targetUrlPattern,
      isActive: config.isActive,
    });
    setConfigModalOpen(true);
  };

  const saveConfig = async () => {
    if (!configDraft.sourceId || !configDraft.name.trim() || !configDraft.targetUrlPattern.trim()) {
      toast.error('Completează sursa, numele și pattern-ul URL.');
      return;
    }

    setConfigSaving(true);
    try {
      if (configEditingId) {
        await api.putApi(`/settings/scraper/configs/${configEditingId}`, {
          name: configDraft.name.trim(),
          targetUrlPattern: configDraft.targetUrlPattern.trim(),
          isActive: configDraft.isActive,
        });
        toast.success('Configurația a fost actualizată.');
      } else {
        await api.postApi('/settings/scraper/configs', {
          sourceId: configDraft.sourceId,
          name: configDraft.name.trim(),
          scraperType: configDraft.scraperType,
          targetUrlPattern: configDraft.targetUrlPattern.trim(),
          isActive: configDraft.isActive,
        });
        toast.success('Configurația a fost creată.');
      }
      setConfigModalOpen(false);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut salva configurația.');
    } finally {
      setConfigSaving(false);
    }
  };

  const purgeFailedQueue = async () => {
    try {
      await api.postApi('/settings/scraper/queue/purge-failed', {});
      toast.success('Elementele eșuate au fost șterse');
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut șterge coada de erori');
    }
  };

  const retryFailedQueue = async () => {
    try {
      await api.postApi('/settings/scraper/queue/retry-failed', {});
      toast.success('Elementele eșuate au fost reprogramate');
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut relansa');
    }
  };

  if (loading) {
    return <DashboardSkeleton rows={2} columns={3} variant="kpi" />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-muted/20 bg-muted/5 p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="font-medium text-body dark:text-slate-100">
          Scraper fallback - Playwright + robots.txt
        </h3>
        <p className="mt-1 text-sm text-muted dark:text-slate-400">
          Fallback pentru pagini JS-heavy. Respectă automat robots.txt și aplică limitare de rată pe
          domeniu.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm dark:border-red-700/50 dark:bg-red-900/20">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-muted/20 bg-background p-4 text-sm dark:border-slate-700 dark:bg-slate-900/80">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            Status browser
            <InfoTooltip title="Status browser" side="bottom" portalToBody>
              Indică dacă Chromium (Playwright) este instalat și funcțional pe server. „Disponibil"
              înseamnă că scraper-ul poate randa pagini JS-heavy. De exemplu, statusul „Neinstalat"
              blochează fallback-ul Playwright. Sfat: rulează „Test browser" pentru a verifica în
              timp real.
            </InfoTooltip>
          </span>
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              STATUS_STYLES[settings?.browserStatus ?? 'error']
            }`}
          >
            {STATUS_LABELS[settings?.browserStatus ?? 'error']}
          </span>
          {health?.checkedAt ? (
            <span>verificat {new Date(health.checkedAt).toLocaleString('ro-RO')}</span>
          ) : null}
        </div>
      </div>

      {settings ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="flex items-center justify-between text-xs text-muted dark:text-slate-400">
                <span>Pagini azi</span>
                <Sparkline data={settings.weekTrends.pagesScraped} color="#2563eb" />
              </div>
              <div className="text-h5 dark:text-slate-100">
                {settings.todayStats.pagesScraped.toLocaleString('ro-RO')}
              </div>
            </div>
            <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="text-xs text-muted dark:text-slate-400">Rata succes</div>
              <div className="mt-2">
                <GaugeChart
                  value={Math.round(settings.todayStats.successRate * 100)}
                  max={100}
                  ariaLabel="Success rate scraper"
                />
              </div>
            </div>
            <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="flex items-center justify-between text-xs text-muted dark:text-slate-400">
                <span>Latență medie</span>
                <Sparkline data={settings.weekTrends.failed} color="#f59e0b" />
              </div>
              <div className="text-h5 dark:text-slate-100">
                {settings.todayStats.avgLatencyMs.toLocaleString('ro-RO', {
                  maximumFractionDigits: 0,
                })}{' '}
                ms
              </div>
            </div>
            <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
              <div className="text-xs text-muted dark:text-slate-400">Cale rapidă Cheerio</div>
              <div className="text-h5 dark:text-slate-100">
                {settings.todayStats.cheerioFastPath}
                <span className="ml-2 rounded-full bg-success/15 px-2 py-1 text-xs text-success">
                  Rapid
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
        className="space-y-4 rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80"
      >
        <span className="inline-flex items-center gap-2">
          <label className="flex items-center gap-2 text-body dark:text-slate-200">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Activează scraper fallback
          </label>
          <InfoTooltip title="Scraper fallback" side="bottom" portalToBody>
            Activează sau dezactivează scraper-ul ca sursă de date de rezervă. Când este activ,
            sistemul va încerca să extragă informații de pe site-urile producătorilor când alte
            surse nu returnează rezultate. De exemplu, dacă API-ul furnizorului nu răspunde,
            scraper-ul poate prelua datele de pe pagina web. Sfat: dezactivează dacă website-urile
            țintă blochează frecvent accesul automat.
          </InfoTooltip>
        </span>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Limită rată per domeniu
              <InfoTooltip title="Limită rată per domeniu" side="bottom" portalToBody>
                Numărul maxim de cereri pe secundă către un singur domeniu. Limitează viteza de
                accesare pentru a respecta politicile site-urilor și a evita blocările. 1–2
                cereri/sec e sigur pentru majoritatea site-urilor; creșteți doar pentru domenii care
                permit.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={1}
              max={5}
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Timeout (ms)
              <InfoTooltip title="Timeout încărcare pagină" side="bottom" portalToBody>
                Timpul maxim de așteptare pentru încărcarea unei pagini înainte de abandon. Paginile
                lente sau cu multe resurse pot necesita valori mai mari. 30 secunde e recomandat;
                reduceți pentru site-uri rapide, creșteți pentru cele grele.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={10000}
              max={120000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Pagini concurente max
              <InfoTooltip title="Pagini concurente max" side="bottom" portalToBody>
                Numărul maxim de pagini Chromium deschise simultan. Mai multe pagini accelerează
                scraping-ul dar consumă mai multă memorie și CPU. 3–5 e un echilibru bun; reduceți
                pe servere cu resurse limitate.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={1}
              max={10}
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
              Cache robots.txt (sec)
              <InfoTooltip title="Cache robots.txt" side="bottom" portalToBody>
                Cât timp se păstrează regulile robots.txt în cache înainte de reîmprospătare.
                robots.txt definește ce pagini pot fi accesate. 86400 sec (24 ore) e recomandat;
                reduceți dacă site-urile își actualizează regulile des.
              </InfoTooltip>
            </span>
            <input
              type="number"
              min={60}
              max={604800}
              value={robotsTtl}
              onChange={(e) => setRobotsTtl(Number(e.target.value))}
              className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            />
          </label>
        </div>

        <label className="space-y-1 text-sm block">
          <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
            User-Agent
            <InfoTooltip title="User-Agent" side="bottom" portalToBody>
              Identificatorul trimis de scraper către site-urile vizitate. Site-urile pot bloca sau
              limita accesul bazat pe acest câmp. De exemplu, „NeaneluPIM/1.0" indică site-urilor că
              traficul provine de la un bot de scraping. Sfat: păstrați valoarea implicită dacă nu
              aveți un motiv specific de modificare.
            </InfoTooltip>
          </span>
          <input
            type="text"
            value={userAgent}
            onChange={(e) => setUserAgent(e.target.value)}
            className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
          />
        </label>

        <div className="rounded-md border border-muted/20 bg-muted/5 p-3 text-xs text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 inline-flex items-center gap-1">
          Respect robots.txt: <span className="font-medium text-success">Întotdeauna activ</span>{' '}
          (RFC 9309)
          <InfoTooltip title="Respect robots.txt" side="bottom" portalToBody>
            Conform RFC 9309, scraper-ul respectă întotdeauna regulile robots.txt ale site-urilor.
            Nu se poate dezactiva – protejează site-urile și evită blocări. Regulile definesc ce
            pagini pot fi accesate automat.
          </InfoTooltip>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton state={submitState}>Salvează setări scraper</SubmitButton>
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => void runHealthCheck()}
              className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm transition-shadow duration-200 hover:bg-muted/10 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:focus:ring-blue-400/50"
              disabled={healthLoading}
            >
              {healthLoading ? 'Se testează...' : 'Test browser'}
            </button>
            <InfoTooltip title="Test browser" side="bottom" portalToBody>
              Verifică dacă Chromium (Playwright) este instalat și funcțional pe server. Testul
              lansează o instanță browser și măsoară timpul de pornire. De exemplu, un test reușit
              arată versiunea Chromium și latența de lansare. Sfat: rulează periodic pentru a
              confirma disponibilitatea scraper-ului.
            </InfoTooltip>
          </span>
          <button
            type="button"
            onClick={() => setDisableConfirmOpen(true)}
            className="rounded-md border border-error/40 px-4 py-2 text-sm font-medium text-error shadow-sm hover:bg-error/5 dark:border-red-700/50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Deconectează
          </button>
          {health ? (
            <span
              className={`text-xs ${health.status === 'available' ? 'text-success' : 'text-error'}`}
            >
              {health.status === 'available'
                ? `Chromium ${health.chromiumVersion ?? '-'} (${(health.launchTimeMs ?? 0).toLocaleString('ro-RO')} ms)`
                : (health.message ?? 'Browser indisponibil')}
            </span>
          ) : null}
        </div>
      </form>

      <div className="rounded-lg border border-muted/20 bg-background p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900/80">
        <div className="text-sm font-medium flex items-center gap-2 dark:text-slate-100">
          <ShieldCheck className="h-4 w-4" />
          Tester URL robots.txt
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={robotsTestUrl}
            onChange={(event) => setRobotsTestUrl(event.target.value)}
            placeholder="https://example.com/product-page"
            className="min-w-[280px] flex-1 rounded-md border border-muted/20 bg-background px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={() => void runRobotsTest()}
            disabled={robotsLoading || !robotsTestUrl.trim()}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/50"
          >
            {robotsLoading ? 'Se testează...' : 'Testează robots.txt'}
          </button>
        </div>
        {robotsResult ? (
          <div
            className={`rounded-md border p-3 text-sm ${robotsResult.allowed ? 'border-success/30 bg-success/10 text-success' : 'border-error/30 bg-error/10 text-error'}`}
          >
            {robotsResult.allowed ? 'Permis' : 'Blocat'} - {robotsResult.domain} (
            {robotsResult.robotsTxtCached ? 'cache' : 'live'})
          </div>
        ) : null}
      </div>

      <ScraperDomainPerformanceTable rows={settings?.domainPerformance ?? []} />

      <div className="rounded-lg border border-muted/20 bg-background p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900/80">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium dark:text-slate-100">Status coadă scraper</div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-muted/20 px-3 py-1 text-xs dark:border-slate-600 dark:text-slate-300"
              onClick={() => setPurgeConfirmOpen(true)}
            >
              Curăță eșuate
            </button>
            <button
              type="button"
              className="rounded-md border border-muted/20 px-3 py-1 text-xs dark:border-slate-600 dark:text-slate-300"
              onClick={() => void retryFailedQueue()}
            >
              Relansează toate eșuate
            </button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-4 text-sm dark:text-slate-200">
          <div className="rounded border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            În așteptare: {queueStatus?.pending?.toLocaleString('ro-RO') ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            În procesare: {queueStatus?.processing?.toLocaleString('ro-RO') ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            Finalizate: {queueStatus?.completed?.toLocaleString('ro-RO') ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            Eșuate: {queueStatus?.failed?.toLocaleString('ro-RO') ?? 0}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs text-muted dark:text-slate-400">Configurații scraper active</div>
          <button
            type="button"
            className="rounded-md border border-muted/20 bg-background px-3 py-1 text-xs shadow-sm hover:bg-muted/10 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
            onClick={openCreateConfig}
          >
            Adaugă configurație
          </button>
        </div>
        {!configRows.length ? (
          <EmptyState
            icon={Cog}
            title="Nicio configurație scraper"
            description="Adaugă o configurație nouă pentru un domeniu."
            actionLabel="Adaugă configurație"
            onAction={openCreateConfig}
          />
        ) : (
          <div className="overflow-auto rounded-md border dark:border-slate-700">
            <table className="w-full text-sm dark:text-slate-200">
              <thead className="bg-muted/20 dark:bg-slate-800/50">
                <tr>
                  <th className="px-3 py-2 text-left">Nume</th>
                  <th className="px-3 py-2 text-left">Sursa</th>
                  <th className="px-3 py-2 text-left">Tip</th>
                  <th className="px-3 py-2 text-left">Pattern URL</th>
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
                      Rata succes
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
                      Ultimul run
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right">Actiuni</th>
                </tr>
              </thead>
              <tbody>
                {configRows.map((config) => (
                  <tr key={config.id} className="border-t border-muted/20 dark:border-slate-700">
                    <td className="px-3 py-2">{config.name}</td>
                    <td className="px-3 py-2">{config.sourceName ?? '-'}</td>
                    <td className="px-3 py-2">{config.scraperType}</td>
                    <td className="px-3 py-2">{config.targetUrlPattern}</td>
                    <td className="px-3 py-2 text-right">
                      {config.successRate != null ? `${config.successRate.toFixed(1)}%` : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {config.lastRunAt ? new Date(config.lastRunAt).toLocaleString('ro-RO') : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="mr-3 text-xs text-primary"
                        onClick={() => openEditConfig(config)}
                      >
                        Editeaza
                      </button>
                      <button
                        type="button"
                        className="text-error text-xs"
                        onClick={() => setDeactivateConfigId(config.id)}
                      >
                        Dezactiveaza
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted dark:text-slate-400">Rulări recente</div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className="rounded border border-muted/20 px-2 py-1 dark:border-slate-600 dark:text-slate-300"
              disabled={page <= 1}
              onClick={() => {
                const next = Math.max(1, page - 1);
                setPage(next);
                void loadAll(next, limit);
              }}
            >
              Anterior
            </button>
            <span>Pagina {page}</span>
            <button
              type="button"
              className="rounded border border-muted/20 px-2 py-1 dark:border-slate-600 dark:text-slate-300"
              onClick={() => {
                const next = page + 1;
                setPage(next);
                void loadAll(next, limit);
              }}
            >
              Următor
            </button>
            <select
              value={limit}
              onChange={(e) => {
                const nextLimit = Number(e.target.value);
                setLimit(nextLimit);
                setPage(1);
                void loadAll(1, nextLimit);
              }}
              className="rounded border border-muted/20 bg-background px-2 py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
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
          <div className="overflow-auto rounded-md border dark:border-slate-700">
            <table className="w-full text-sm dark:text-slate-200">
              <thead className="bg-muted/20 dark:bg-slate-800/50">
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
                      Început la
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">Config</th>
                  <th className="px-3 py-2 text-left">Metodă</th>
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
                  <th className="px-3 py-2 text-right">Pagini</th>
                  <th className="px-3 py-2 text-right">Produse</th>
                  <th className="px-3 py-2 text-right">Erori</th>
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
                      Durată
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {runRows.map((run) => (
                  <tr key={run.id} className="border-t border-muted/20 dark:border-slate-700">
                    <td className="px-3 py-2">
                      {run.startedAt ? new Date(run.startedAt).toLocaleString('ro-RO') : '-'}
                    </td>
                    <td className="px-3 py-2">{run.configName ?? run.configId}</td>
                    <td className="px-3 py-2">
                      {run.method === 'cheerio' ? (
                        <span className="rounded-full bg-success/15 px-2 py-1 text-xs text-success">
                          Rapid
                        </span>
                      ) : (
                        <span className="rounded-full bg-warning/15 px-2 py-1 text-xs text-warning">
                          Randare completă
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${RUN_STATUS_STYLES[run.status]}`}
                      >
                        {RUN_STATUS_LABELS[run.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {run.pagesCrawled?.toLocaleString('ro-RO') ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {run.productsFound?.toLocaleString('ro-RO') ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {run.errorsCount?.toLocaleString('ro-RO') ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {run.durationMs != null
                        ? `${run.durationMs.toLocaleString('ro-RO')} ms`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PolarisModal open={configModalOpen} onClose={() => setConfigModalOpen(false)}>
        <div className="space-y-4 p-4 dark:text-slate-200">
          <div className="text-h3 dark:text-slate-100">
            {configEditingId ? 'Editează configurația scraper' : 'Adaugă configurație scraper'}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-caption text-muted dark:text-slate-400">
                Sursa (prod_sources)
              </label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                value={configDraft.sourceId}
                onChange={(e) =>
                  setConfigDraft((p) => ({ ...p, sourceId: (e.target as HTMLSelectElement).value }))
                }
              >
                <option value="">Selecteaza sursa</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {sources.length === 0 ? (
                <div className="mt-1 text-xs text-muted">
                  Nu exista surse disponibile in `prod_sources` pentru acest shop.
                </div>
              ) : null}
            </div>

            <div>
              <label className="text-caption text-muted dark:text-slate-400">Tip scraper</label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                value={configDraft.scraperType}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    scraperType: (e.target as HTMLSelectElement)
                      .value as ScraperConfigResponse['scraperType'],
                  }))
                }
              >
                <option value="PLAYWRIGHT">PLAYWRIGHT</option>
                <option value="CHEERIO">CHEERIO</option>
                <option value="PUPPETEER">PUPPETEER</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-caption text-muted dark:text-slate-400">Nume</label>
              <input
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                value={configDraft.name}
                onChange={(e) =>
                  setConfigDraft((p) => ({ ...p, name: (e.target as HTMLInputElement).value }))
                }
              />
            </div>
            <div>
              <label className="text-caption text-muted dark:text-slate-400">Pattern URL</label>
              <input
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                placeholder="https://example.com/product-page"
                value={configDraft.targetUrlPattern}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    targetUrlPattern: (e.target as HTMLInputElement).value,
                  }))
                }
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={configDraft.isActive}
              onChange={(e) =>
                setConfigDraft((p) => ({ ...p, isActive: (e.target as HTMLInputElement).checked }))
              }
            />
            Activ
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-muted/20 bg-background px-4 py-2 text-sm hover:bg-muted/10 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
              onClick={() => setConfigModalOpen(false)}
              disabled={configSaving}
            >
              Renunta
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm text-background shadow-sm hover:bg-primary/90 disabled:opacity-50"
              onClick={() => void saveConfig()}
              disabled={configSaving}
            >
              {configSaving ? 'Salvez...' : 'Salveaza'}
            </button>
          </div>
        </div>
      </PolarisModal>

      <ConfirmDialog
        open={deactivateConfigId != null}
        title="Dezactivezi configurația?"
        message="Configurația nu va mai fi folosită pentru matching."
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
        title="Ștergi toate elementele eșuate?"
        message="Acțiunea curăță doar elementele eșuate din coada scraper."
        confirmLabel="Curăță eșuate"
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
