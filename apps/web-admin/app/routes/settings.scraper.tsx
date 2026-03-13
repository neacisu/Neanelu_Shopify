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
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { TextField } from '../components/ui/text-field';
import { Select, type SelectOption } from '../components/ui/select';
import { ConfirmDialog } from '../components/domain/confirm-dialog';
import { DataFreshnessIndicator } from '../components/domain/DataFreshnessIndicator';
import { GaugeChart } from '../components/charts/GaugeChart';
import { Sparkline } from '../components/charts/Sparkline';
import { DashboardSkeleton } from '../components/patterns/DashboardSkeleton';
import { EmptyState } from '../components/patterns/empty-state';
import { ErrorState } from '../components/patterns/error-state';
import { useApiClient } from '../hooks/use-api';
import { ScraperActivityChart } from '../components/domain/ScraperActivityChart';
import { ScraperDomainPerformanceTable } from '../components/domain/ScraperDomainPerformanceTable';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Modal } from '../components/ui/modal';

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
  running: 'bg-primary/15 text-primary',
  completed: 'bg-success/15 text-success',
  failed: 'bg-error/15 text-error',
  cancelled: 'bg-muted/20 text-muted',
  deduped: 'bg-muted/20 text-muted',
};
const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  pending: 'În așteptare',
  running: 'În curs',
  completed: 'Finalizat',
  failed: 'Eșuat',
  cancelled: 'Anulat',
  deduped: 'Deduplicat',
};

const PAGINATION_OPTIONS: SelectOption[] = [
  { value: '10', label: '10' },
  { value: '25', label: '25' },
  { value: '50', label: '50' },
];

const SCRAPER_TYPE_OPTIONS: SelectOption[] = [
  { value: 'PLAYWRIGHT', label: 'PLAYWRIGHT' },
  { value: 'CHEERIO', label: 'CHEERIO' },
  { value: 'PUPPETEER', label: 'PUPPETEER' },
];

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
      <div className="rounded-lg border border-muted/20 bg-muted/5 p-4">
        <h3 className="font-medium text-foreground">Scraper fallback - Playwright + robots.txt</h3>
        <p className="mt-1 text-sm text-muted">
          Fallback pentru pagini JS-heavy. Respectă automat robots.txt și aplică limitare de rată pe
          domeniu.
        </p>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div className="rounded-lg border border-border bg-background p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
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
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Pagini azi</span>
                <Sparkline
                  data={settings.weekTrends.pagesScraped}
                  color="rgb(var(--color-primary))"
                />
              </div>
              <div className="text-h5">
                {settings.todayStats.pagesScraped.toLocaleString('ro-RO')}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="text-xs text-muted">Rata succes</div>
              <div className="mt-2">
                <GaugeChart
                  value={Math.round(settings.todayStats.successRate * 100)}
                  max={100}
                  ariaLabel="Success rate scraper"
                />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Latență medie</span>
                <Sparkline data={settings.weekTrends.failed} color="rgb(var(--color-warning))" />
              </div>
              <div className="text-h5">
                {settings.todayStats.avgLatencyMs.toLocaleString('ro-RO', {
                  maximumFractionDigits: 0,
                })}{' '}
                ms
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="text-xs text-muted">Cale rapidă Cheerio</div>
              <div className="text-h5">
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
        className="space-y-4 rounded-lg border border-border bg-background p-4"
      >
        <span className="inline-flex items-center gap-2">
          <label className="flex items-center gap-2 text-foreground">
            <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
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
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Limită rată per domeniu
              <InfoTooltip title="Limită rată per domeniu" side="bottom" portalToBody>
                Numărul maxim de cereri pe secundă către un singur domeniu. Limitează viteza de
                accesare pentru a respecta politicile site-urilor și a evita blocările. 1–2
                cereri/sec e sigur pentru majoritatea site-urilor; creșteți doar pentru domenii care
                permit.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={1}
              max={5}
              value={String(rateLimit)}
              onChange={(e) => setRateLimit(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Timeout (ms)
              <InfoTooltip title="Timeout încărcare pagină" side="bottom" portalToBody>
                Timpul maxim de așteptare pentru încărcarea unei pagini înainte de abandon. Paginile
                lente sau cu multe resurse pot necesita valori mai mari. 30 secunde e recomandat;
                reduceți pentru site-uri rapide, creșteți pentru cele grele.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={10000}
              max={120000}
              value={String(timeoutMs)}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Pagini concurente max
              <InfoTooltip title="Pagini concurente max" side="bottom" portalToBody>
                Numărul maxim de pagini Chromium deschise simultan. Mai multe pagini accelerează
                scraping-ul dar consumă mai multă memorie și CPU. 3–5 e un echilibru bun; reduceți
                pe servere cu resurse limitate.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={1}
              max={10}
              value={String(maxPages)}
              onChange={(e) => setMaxPages(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1 text-sm">
            <span className="text-muted inline-flex items-center gap-1">
              Cache robots.txt (sec)
              <InfoTooltip title="Cache robots.txt" side="bottom" portalToBody>
                Cât timp se păstrează regulile robots.txt în cache înainte de reîmprospătare.
                robots.txt definește ce pagini pot fi accesate. 86400 sec (24 ore) e recomandat;
                reduceți dacă site-urile își actualizează regulile des.
              </InfoTooltip>
            </span>
            <TextField
              type="number"
              min={60}
              max={604800}
              value={String(robotsTtl)}
              onChange={(e) => setRobotsTtl(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="space-y-1 text-sm block">
          <span className="text-muted inline-flex items-center gap-1">
            User-Agent
            <InfoTooltip title="User-Agent" side="bottom" portalToBody>
              Identificatorul trimis de scraper către site-urile vizitate. Site-urile pot bloca sau
              limita accesul bazat pe acest câmp. De exemplu, „NeaneluPIM/1.0" indică site-urilor că
              traficul provine de la un bot de scraping. Sfat: păstrați valoarea implicită dacă nu
              aveți un motiv specific de modificare.
            </InfoTooltip>
          </span>
          <TextField type="text" value={userAgent} onChange={(e) => setUserAgent(e.target.value)} />
        </div>

        <div className="rounded-md border border-muted/20 bg-muted/5 p-3 text-xs text-muted inline-flex items-center gap-1">
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => void runHealthCheck()}
              loading={healthLoading}
              disabled={healthLoading}
            >
              {healthLoading ? 'Se testează...' : 'Test browser'}
            </Button>
            <InfoTooltip title="Test browser" side="bottom" portalToBody>
              Verifică dacă Chromium (Playwright) este instalat și funcțional pe server. Testul
              lansează o instanță browser și măsoară timpul de pornire. De exemplu, un test reușit
              arată versiunea Chromium și latența de lansare. Sfat: rulează periodic pentru a
              confirma disponibilitatea scraper-ului.
            </InfoTooltip>
          </span>
          <Button type="button" variant="destructive" onClick={() => setDisableConfirmOpen(true)}>
            Deconectează
          </Button>
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

      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
        <div className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Tester URL robots.txt
        </div>
        <div className="flex flex-wrap gap-2">
          <TextField
            value={robotsTestUrl}
            onChange={(event) => setRobotsTestUrl(event.target.value)}
            placeholder="https://example.com/product-page"
            className="min-w-[280px] flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void runRobotsTest()}
            disabled={robotsLoading || !robotsTestUrl.trim()}
            loading={robotsLoading}
          >
            {robotsLoading ? 'Se testează...' : 'Testează robots.txt'}
          </Button>
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

      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Status coadă scraper</div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPurgeConfirmOpen(true)}
            >
              Curăță eșuate
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void retryFailedQueue()}
            >
              Relansează toate eșuate
            </Button>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-4 text-sm">
          <div className="rounded border border-muted/20 p-3">
            În așteptare: {queueStatus?.pending?.toLocaleString('ro-RO') ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3">
            În procesare: {queueStatus?.processing?.toLocaleString('ro-RO') ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3">
            Finalizate: {queueStatus?.completed?.toLocaleString('ro-RO') ?? 0}
          </div>
          <div className="rounded border border-muted/20 p-3">
            Eșuate: {queueStatus?.failed?.toLocaleString('ro-RO') ?? 0}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs text-muted">Configurații scraper active</div>
          <Button type="button" variant="secondary" size="sm" onClick={openCreateConfig}>
            Adaugă configurație
          </Button>
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
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/20">
                <tr>
                  <th className="px-3 py-2 text-left">Nume</th>
                  <th className="px-3 py-2 text-left">Sursa</th>
                  <th className="px-3 py-2 text-left">Tip</th>
                  <th className="px-3 py-2 text-left">Pattern URL</th>
                  <th className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="interactive inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-ring-standard"
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
                      className="interactive inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-ring-standard"
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
                  <tr key={config.id} className="border-t border-muted/20">
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditConfig(config)}
                      >
                        Editează
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeactivateConfigId(config.id)}
                      >
                        Dezactivează
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted">Rulări recente</div>
          <div className="flex items-center gap-2 text-xs">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const next = Math.max(1, page - 1);
                setPage(next);
                void loadAll(next, limit);
              }}
            >
              Anterior
            </Button>
            <span>Pagina {page}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const next = page + 1;
                setPage(next);
                void loadAll(next, limit);
              }}
            >
              Următor
            </Button>
            <Select
              value={String(limit)}
              onChange={(e) => {
                const nextLimit = Number(e.target.value);
                setLimit(nextLimit);
                setPage(1);
                void loadAll(1, nextLimit);
              }}
              options={PAGINATION_OPTIONS}
            />
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
                      className="interactive inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-ring-standard"
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
                      className="interactive inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-ring-standard"
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
                      className="interactive inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-ring-standard"
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
                  <tr key={run.id} className="border-t border-muted/20">
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

      <Modal open={configModalOpen} onClose={() => setConfigModalOpen(false)}>
        <div className="space-y-4 p-4">
          <div className="text-h3">
            {configEditingId ? 'Editează configurația scraper' : 'Adaugă configurație scraper'}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Select
                label="Sursa (prod_sources)"
                value={configDraft.sourceId}
                onChange={(e) => setConfigDraft((p) => ({ ...p, sourceId: e.target.value }))}
                options={[
                  { value: '', label: 'Selecteaza sursa' },
                  ...sources.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
              {sources.length === 0 ? (
                <div className="mt-1 text-xs text-muted">
                  Nu exista surse disponibile in `prod_sources` pentru acest shop.
                </div>
              ) : null}
            </div>

            <div>
              <Select
                label="Tip scraper"
                value={configDraft.scraperType}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    scraperType: e.target.value as ScraperConfigResponse['scraperType'],
                  }))
                }
                options={SCRAPER_TYPE_OPTIONS}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <TextField
                label="Nume"
                value={configDraft.name}
                onChange={(e) => setConfigDraft((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <TextField
                label="Pattern URL"
                placeholder="https://example.com/product-page"
                value={configDraft.targetUrlPattern}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    targetUrlPattern: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={configDraft.isActive}
              onChange={(e) =>
                setConfigDraft((p) => ({ ...p, isActive: (e.target as HTMLInputElement).checked }))
              }
            />
            Activ
          </label>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfigModalOpen(false)}
              disabled={configSaving}
            >
              Renunță
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void saveConfig()}
              disabled={configSaving}
              loading={configSaving}
            >
              {configSaving ? 'Salvez...' : 'Salvează'}
            </Button>
          </div>
        </div>
      </Modal>

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
