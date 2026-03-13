import {
  RefreshCw,
  FolderOpen,
  Layers,
  Sparkles,
  Tag,
  Package,
  Languages,
  CircleOff,
  GitBranch,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Clock3,
  LoaderCircle,
  X,
  FileText,
  ImageIcon,
  ExternalLink,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { SearchInput } from '../components/ui/SearchInput';
import { ProgressBar } from '../components/ui/progress-bar';
import { EmptyState } from '../components/patterns';
import { ErrorState } from '../components/patterns/error-state';
import { LoadingState } from '../components/patterns/loading-state.js';
import { Badge } from '../components/ui/badge';
import { Modal } from '../components/ui/modal';
import { Select, type SelectOption } from '../components/ui/select.js';
import { TextField } from '../components/ui/text-field.js';
import { useApiClient } from '../hooks/use-api';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { useScrollReveal } from '../hooks/useScrollReveal';

const COLLECTION_TYPE_OPTIONS: SelectOption[] = [
  { label: 'Toate tipurile', value: 'all' },
  { label: 'Manual', value: 'MANUAL' },
  { label: 'Smart', value: 'SMART' },
];

const TAXONOMY_OPTIONS: SelectOption[] = [
  { label: 'Orice taxonomie', value: 'all' },
  { label: 'Cu taxonomie', value: 'true' },
  { label: 'Fără taxonomie', value: 'false' },
];

const MENU_LEVEL_OPTIONS: SelectOption[] = [
  { label: 'Orice nivel', value: 'all' },
  { label: 'În meniu', value: 'in_menu' },
  { label: 'Root (părinte)', value: '0' },
  { label: 'Nivel 1', value: '1' },
  { label: 'Nivel 2', value: '2' },
  { label: 'Neclasificate', value: 'none' },
];

const MENU_AI_STATE_OPTIONS: SelectOption[] = [
  { label: 'Orice status menu AI', value: 'all' },
  { label: 'Cu asocieri AI', value: 'has_assignments' },
  { label: 'Cu propuneri în review', value: 'review_required' },
  { label: 'Multiparent AI', value: 'multiparent' },
];

const PAGE_SIZE_OPTIONS: SelectOption[] = [
  { label: '10 / pagină', value: '10' },
  { label: '25 / pagină', value: '25' },
  { label: '50 / pagină', value: '50' },
  { label: '100 / pagină', value: '100' },
];

interface CollectionRow {
  id: string;
  shopify_gid: string;
  legacy_resource_id: number;
  title: string;
  title_en: string | null;
  handle: string;
  collection_type: string;
  products_count: number;
  taxonomy_count: number;
  taxonomy_name: string | null;
  synced_at: string | null;
  description: string | null;
  description_html: string | null;
  description_en: string | null;
  image_url: string | null;
  has_pending_image: boolean;
  parent_collection_id: string | null;
  parent_title: string | null;
  menu_level: number | null;
  menu_path: string | null;
  menu_assignment_count: number;
  menu_review_count: number;
}

interface CollectionsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface CollectionsStats {
  total: number;
  manual: number;
  smart: number;
  withTaxonomy: number;
  translated: number;
  withDescription: number;
  withImage: number;
  inMenu: number;
  roots: number;
  notInMenu: number;
  totalProducts: number;
  lastSyncedAt: string | null;
}

type PendingChangeType =
  | 'field_update'
  | 'taxonomy_assign'
  | 'taxonomy_unassign'
  | 'menu_assign'
  | 'product_dissociate'
  | 'metafield_definition_create';

interface PendingChangesByType {
  field_update: number;
  taxonomy_assign: number;
  taxonomy_unassign: number;
  menu_assign: number;
  product_dissociate: number;
  metafield_definition_create: number;
}

interface PendingChangeRow {
  id: string;
  collectionId: string;
  collectionTitle: string;
  changeType: PendingChangeType;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  metadata: Record<string, unknown>;
  source: string;
  shopifyMutation: string | null;
  createdAt: string;
}

type SyncStatus = 'idle' | 'active' | 'completed' | 'failed' | 'waiting' | 'delayed';

interface SyncProgressPayload {
  fetched?: number;
  total?: number;
  percent?: number;
  phase?: string;
  current?: number;
  menuItems?: number;
  correlated?: number;
  menuItemsEmbedded?: number;
  menuItemsTotal?: number;
  embeddingErrors?: number;
  embeddingError?: boolean;
  hierarchyError?: boolean;
  status?: string;
}

interface SyncProgress {
  status: SyncStatus;
  progress: SyncProgressPayload | number | null;
  createdAt?: string | null;
  processedOn?: string | null;
  finishedOn?: string | null;
  failedReason?: string | null;
}

type SyncStepStatus = 'pending' | 'active' | 'done' | 'error';

interface SyncStepItem {
  key: string;
  label: string;
  detail: string;
  status: SyncStepStatus;
}

interface MenuAssignmentItem {
  id: string;
  menuItemId: string | null;
  menuItemTitle: string;
  menuItemPath: string;
  menuItemLevel: number | null;
  assignmentSource: string;
  isPrimary: boolean;
  confidence: number | null;
  reasoning: string | null;
  translatedQuery: string | null;
  proposedPath: string | null;
  status: string;
  createdAt: string;
  approvedAt: string | null;
}

interface MenuAssignmentStatusResponse {
  activeAssignments: MenuAssignmentItem[];
  proposedAssignments: MenuAssignmentItem[];
  rejectedAssignments: MenuAssignmentItem[];
  primaryAssignment: MenuAssignmentItem | null;
  collectionMenuPath: string | null;
  canRunAi: boolean;
}

type ConsensusMethod = 'unanimous' | 'majority' | 'arbitration' | 'single_fallback';

type SelectAllMode = 'page' | 'all' | null;

function formatRelativeDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  const absMin = Math.abs(diffMin);
  const rtf = new Intl.RelativeTimeFormat('ro-RO', { numeric: 'auto' });
  if (absMin < 60) return rtf.format(diffMin, 'minute');
  const diffHours = Math.round(diffMin / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

function formatAbsoluteDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function parseMenuPath(menuPath: string | null): string[] {
  if (!menuPath) return [];
  return menuPath
    .split('>')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function formatConfidence(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatConsensusScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

function consensusBadgeTone(
  value: number | null | undefined
): 'success' | 'warning' | 'critical' | 'neutral' {
  if (value == null || Number.isNaN(value)) return 'neutral';
  if (value >= 0.75) return 'success';
  if (value >= 0.5) return 'warning';
  return 'critical';
}

function formatConsensusMethod(value: ConsensusMethod | null | undefined): string {
  if (!value) return 'n/a';
  if (value === 'unanimous') return 'unanim 4/4';
  if (value === 'majority') return 'majority 3/4';
  if (value === 'arbitration') return 'arbitrare QwQ-32B';
  return 'fallback single';
}

function buildConsensusTooltip(
  method: ConsensusMethod | null | undefined,
  score: number | null | undefined
): string {
  return `Metoda: ${formatConsensusMethod(method)} · scor: ${formatConsensusScore(score)}`;
}

function buildMenuAssignmentSummary(collection: CollectionRow): string {
  if (collection.menu_assignment_count <= 0 && collection.menu_review_count <= 0) {
    return '—';
  }
  if (collection.menu_review_count > 0) {
    return `${collection.menu_assignment_count} active / ${collection.menu_review_count} review`;
  }
  return `${collection.menu_assignment_count} active`;
}

function isRunningSyncStatus(status: SyncStatus): boolean {
  return status === 'active' || status === 'waiting' || status === 'delayed';
}

function getSyncPayload(progress: SyncProgress['progress']): SyncProgressPayload | null {
  if (!progress || typeof progress === 'number') return null;
  return progress;
}

function buildSyncSteps(syncState: SyncProgress): SyncStepItem[] {
  const payload = getSyncPayload(syncState.progress);
  const phase = payload?.phase ?? null;

  let currentStepIndex = -1;
  if (syncState.status === 'waiting' || syncState.status === 'delayed') {
    currentStepIndex = 0;
  } else if (phase === 'collections') {
    currentStepIndex = 1;
  } else if (phase === 'menus') {
    currentStepIndex = 2;
  } else if (phase === 'hierarchy') {
    currentStepIndex = 3;
  } else if (phase === 'embedding_menu_items') {
    currentStepIndex = 4;
  } else if (phase === 'done' || syncState.status === 'completed') {
    currentStepIndex = 5;
  } else if (syncState.status === 'failed') {
    currentStepIndex =
      phase === 'embedding_menu_items'
        ? 4
        : phase === 'hierarchy'
          ? 3
          : phase === 'menus'
            ? 2
            : phase === 'collections'
              ? 1
              : 0;
  }

  const resolveStepStatus = (index: number): SyncStepStatus => {
    if (syncState.status === 'completed' || currentStepIndex > index) return 'done';
    if (syncState.status === 'failed' && currentStepIndex === index) return 'error';
    if (currentStepIndex === index && isRunningSyncStatus(syncState.status)) return 'active';
    if (currentStepIndex === 5 && index <= 5) return 'done';
    return 'pending';
  };

  const menuCurrent = payload?.current ?? null;
  const menuTotal = payload?.total ?? null;
  const fetched = payload?.fetched ?? null;
  const menuItems = payload?.menuItems ?? null;
  const correlated = payload?.correlated ?? null;
  const menuItemsEmbedded = payload?.menuItemsEmbedded ?? null;
  const menuItemsTotal = payload?.menuItemsTotal ?? null;

  return [
    {
      key: 'queued',
      label: 'Job în coadă',
      detail:
        syncState.status === 'delayed'
          ? 'Job-ul așteaptă resursele worker-ului.'
          : syncState.createdAt
            ? `Creat la ${formatAbsoluteDateTime(syncState.createdAt)}`
            : 'Cererea de sincronizare a fost trimisă.',
      status: resolveStepStatus(0),
    },
    {
      key: 'collections',
      label: 'Import colecții',
      detail:
        fetched != null
          ? `${fetched.toLocaleString('ro-RO')} colecții importate`
          : 'Import paginat din Shopify.',
      status: resolveStepStatus(1),
    },
    {
      key: 'menus',
      label: 'Import meniuri Shopify',
      detail:
        menuCurrent != null && menuTotal != null
          ? `Meniu ${menuCurrent}/${menuTotal} procesat`
          : 'Se importă structura meniurilor.',
      status: resolveStepStatus(2),
    },
    {
      key: 'hierarchy',
      label: 'Corelare ierarhie categorii',
      detail:
        menuItems != null || correlated != null
          ? `${menuItems?.toLocaleString('ro-RO') ?? 0} itemi meniu, ${correlated?.toLocaleString('ro-RO') ?? 0} relații părinte-copil`
          : 'Se leagă colecțiile de structura categorii-produse.',
      status:
        payload?.hierarchyError === true && syncState.status !== 'completed'
          ? 'error'
          : resolveStepStatus(3),
    },
    {
      key: 'embedding_menu_items',
      label: 'Generare embeddings meniu',
      detail:
        menuItemsEmbedded != null && menuItemsTotal != null
          ? `${menuItemsEmbedded.toLocaleString('ro-RO')}/${menuItemsTotal.toLocaleString('ro-RO')} embeddings`
          : 'Se pregătesc embeddings pentru itemii de meniu.',
      status:
        payload?.embeddingError === true && syncState.status !== 'completed'
          ? 'error'
          : resolveStepStatus(4),
    },
    {
      key: 'done',
      label: 'Finalizare și refresh UI',
      detail:
        syncState.finishedOn != null
          ? `Terminat la ${formatAbsoluteDateTime(syncState.finishedOn)}`
          : 'Se actualizează datele din interfață.',
      status: resolveStepStatus(5),
    },
  ];
}

function CategoryTreeCell({
  menuPath,
  currentTitle,
}: {
  menuPath: string | null;
  currentTitle: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const segments = useMemo(() => parseMenuPath(menuPath), [menuPath]);

  if (segments.length === 0) {
    return <span className="text-muted">—</span>;
  }

  if (segments.length === 1) {
    return <span className="text-xs text-muted">{segments[0]}</span>;
  }

  const parentLabel = segments[segments.length - 2] ?? segments[0];

  return (
    <div className="min-w-45" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-left text-xs text-muted hover:text-foreground"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className="truncate">{expanded ? segments[0] : parentLabel}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {segments.map((segment, index) => {
            const isCurrent = index === segments.length - 1;
            return (
              <div
                key={`${segment}-${index}`}
                className={`flex items-center gap-1 text-xs ${
                  isCurrent ? 'font-semibold text-foreground' : 'text-muted'
                }`}
                style={{ paddingLeft: `${index * 12}px` }}
              >
                {index > 0 && <span className="text-muted">└─</span>}
                <span className="truncate">{isCurrent ? currentTitle : segment}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function asDisplayText(value: unknown, fallback = '—'): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Da' : 'Nu';
  return fallback;
}

function getDraftFieldValue(
  collection: CollectionRow,
  titleEn: string | null,
  draftFields: Record<string, string>,
  fieldKey: string
): string {
  if (fieldKey in draftFields) {
    return draftFields[fieldKey] ?? '';
  }

  switch (fieldKey) {
    case 'title':
      return collection.title ?? '';
    case 'title_en':
      return titleEn ?? '';
    case 'description':
      return collection.description ?? '';
    case 'description_en':
      return collection.description_en ?? '';
    default:
      return '';
  }
}

function renderPendingChangeSummary(row: PendingChangeRow) {
  if (row.changeType === 'field_update') {
    return (
      <div className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">
          {row.fieldName === 'title' ? 'Titlu' : 'Descriere'}
        </div>
        <div className="text-sm text-muted line-through">{row.oldValue ?? '—'}</div>
        <div className="text-sm font-medium text-success">{row.newValue ?? '—'}</div>
      </div>
    );
  }

  if (row.changeType === 'taxonomy_assign') {
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium text-foreground">
          {asDisplayText(row.metadata['taxonomyName'], 'Taxonomie nouă')}
        </div>
        <div className="text-muted">
          Veche: {asDisplayText(row.metadata['previousTaxonomyName'])}
        </div>
        <div className="text-muted">
          Metafields: {asDisplayText(row.metadata['metafieldCount'], '0')}
        </div>
      </div>
    );
  }

  if (row.changeType === 'taxonomy_unassign') {
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium text-foreground">
          {asDisplayText(row.metadata['taxonomyName'], 'Taxonomie eliminată')}
        </div>
        <div className="text-muted">
          Metafields de șters: {asDisplayText(row.metadata['metafieldCount'], '0')}
        </div>
      </div>
    );
  }

  if (row.changeType === 'product_dissociate') {
    const productGids = row.metadata['productGids'];
    const count = Array.isArray(productGids) ? productGids.length : 0;
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium text-foreground">
          {count} produs(e) de dezasociat din Shopify
        </div>
        <div className="text-muted">
          Colecție GID: {asDisplayText(row.metadata['collectionGid'])}
        </div>
      </div>
    );
  }

  if (row.changeType === 'metafield_definition_create') {
    const metafields = row.metadata['metafields'];
    const count = Array.isArray(metafields) ? metafields.length : 0;
    interface MfItem {
      attr_code?: string;
      display_name_ro?: string;
      shopify_type?: string;
    }
    const items = Array.isArray(metafields) ? (metafields as MfItem[]) : [];
    return (
      <div className="space-y-1.5 text-sm">
        <div className="font-medium text-foreground">
          {count} definiție(ii) metafield de creat în Shopify
        </div>
        {items.slice(0, 5).map((mf) => (
          <div key={mf.attr_code} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="font-mono">{mf.attr_code}</span>
            {mf.display_name_ro && <span>— {mf.display_name_ro}</span>}
            {mf.shopify_type && (
              <span className="rounded bg-primary/10 px-1 py-0.5 font-mono text-[10px] text-primary">
                {mf.shopify_type}
              </span>
            )}
          </div>
        ))}
        {count > 5 && <div className="text-xs text-muted">+{count - 5} mai multe...</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1 text-sm">
      <div className="font-medium text-foreground">
        {asDisplayText(row.metadata['action'], 'update')}
      </div>
      <div className="text-muted">
        Path: {asDisplayText(row.metadata['parentPath'] ?? row.metadata['proposedPath'])}
      </div>
      <div className="text-muted">
        Meniu: {asDisplayText(row.metadata['menuTitle'] ?? row.metadata['menuHandle'])}
      </div>
    </div>
  );
}

function PendingChangesSection({
  title,
  rows,
  onReject,
}: {
  title: string;
  rows: PendingChangeRow[];
  onReject: (changeId: string) => Promise<void>;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Badge tone="neutral">{rows.length}</Badge>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full table-fixed divide-y divide-border/60 text-sm">
          <thead className="bg-subtle">
            <tr>
              <th className="w-[15%] px-4 py-2 text-left font-medium text-muted">Colecție</th>
              <th className="w-[45%] px-4 py-2 text-left font-medium text-muted">Schimbare</th>
              <th className="w-[10%] px-4 py-2 text-left font-medium text-muted">Sursă</th>
              <th className="w-[16%] px-4 py-2 text-left font-medium text-muted">Data</th>
              <th className="w-[14%] px-4 py-2 text-right font-medium text-muted">Acțiune</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 bg-card">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-medium text-foreground">{row.collectionTitle}</td>
                <td className="px-4 py-3">{renderPendingChangeSummary(row)}</td>
                <td className="px-4 py-3 text-muted">{row.source}</td>
                <td className="px-4 py-3 text-muted whitespace-nowrap">
                  {new Date(row.createdAt).toLocaleString('ro-RO')}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" onClick={() => void onReject(row.id)}>
                    Respinge
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CollectionsPage() {
  const api = useApiClient();
  const reducedMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  const limit = parseInt(searchParams.get('limit') ?? '25', 10) || 25;
  const search = searchParams.get('search') ?? '';
  const type = searchParams.get('type') ?? 'all';
  const hasTaxonomy = searchParams.get('hasTaxonomy') ?? 'all';
  const hasTranslation = searchParams.get('hasTranslation') ?? 'all';
  const hasDescription = searchParams.get('hasDescription') ?? 'all';
  const hasImage = searchParams.get('hasImage') ?? 'all';
  const menuLevel = searchParams.get('menuLevel') ?? 'all';
  const menuAiState = searchParams.get('menuAiState') ?? 'all';
  const sortBy = searchParams.get('sortBy') ?? 'synced_at';
  const sortDir = searchParams.get('sortDir') ?? 'desc';

  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [pagination, setPagination] = useState<CollectionsPagination | null>(null);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);

  const [stats, setStats] = useState<CollectionsStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectAllMode, setSelectAllMode] = useState<SelectAllMode>(null);
  const [selectedCollection, setSelectedCollection] = useState<CollectionRow | null>(null);

  const [syncState, setSyncState] = useState<SyncProgress>({
    status: 'idle',
    progress: null,
  });
  const [syncPanelHidden, setSyncPanelHidden] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncStatusRef = useRef<SyncStatus>('idle');
  const syncStartRef = useRef<number | null>(null);
  const [syncElapsedMs, setSyncElapsedMs] = useState(0);

  const [bulkTaxonomyLoading, setBulkTaxonomyLoading] = useState(false);
  const [bulkTranslateLoading, setBulkTranslateLoading] = useState(false);
  const [pendingChangesCount, setPendingChangesCount] = useState(0);
  const [pendingChangesByType, setPendingChangesByType] = useState<PendingChangesByType>({
    field_update: 0,
    taxonomy_assign: 0,
    taxonomy_unassign: 0,
    menu_assign: 0,
    product_dissociate: 0,
    metafield_definition_create: 0,
  });
  const [pendingChangesOpen, setPendingChangesOpen] = useState(false);
  const [pendingChangesLoading, setPendingChangesLoading] = useState(false);
  const [pendingChangesApproving, setPendingChangesApproving] = useState(false);
  const [pendingChangesRows, setPendingChangesRows] = useState<PendingChangeRow[]>([]);

  interface BulkCollectionStep {
    step: string;
    message: string;
    status: 'in_progress' | 'done' | 'error';
  }
  interface BulkCollectionEntry {
    collectionId: string;
    collectionTitle: string;
    steps: BulkCollectionStep[];
    finalStatus:
      | 'running'
      | 'assigned'
      | 'low_confidence'
      | 'proposed'
      | 'review_required'
      | 'error';
    resultMessage: string | null;
    expanded: boolean;
    consensusMethod?: ConsensusMethod | null;
    consensusScore?: number | null;
  }
  const [bulkProgress, setBulkProgress] = useState<BulkCollectionEntry[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  const [bulkMenuProgress, setBulkMenuProgress] = useState<BulkCollectionEntry[]>([]);
  const [bulkMenuRunning, setBulkMenuRunning] = useState(false);

  const [translateProgress, setTranslateProgress] = useState<BulkCollectionEntry[]>([]);
  const [translateRunning, setTranslateRunning] = useState(false);

  const isSyncing =
    syncState.status === 'active' ||
    syncState.status === 'waiting' ||
    syncState.status === 'delayed';
  const showSyncPanel = syncState.status !== 'idle' && !syncPanelHidden;

  const breadcrumbs = useMemo(() => [{ label: 'Acasă', href: '/' }, { label: 'Colecții' }], []);

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (search) params.set('search', search);
      if (type !== 'all') params.set('type', type);
      if (hasTaxonomy !== 'all') params.set('hasTaxonomy', hasTaxonomy);
      if (hasTranslation !== 'all') params.set('hasTranslation', hasTranslation);
      if (hasDescription !== 'all') params.set('hasDescription', hasDescription);
      if (hasImage !== 'all') params.set('hasImage', hasImage);
      if (menuLevel !== 'all') params.set('menuLevel', menuLevel);
      if (menuAiState !== 'all') params.set('menuAiState', menuAiState);
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);

      const result = await api.getApi<{
        collections: CollectionRow[];
        pagination: CollectionsPagination;
      }>(`/collections?${params.toString()}`);

      setCollections(result.collections);
      setPagination(result.pagination);
      setCollectionsError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Eroare la încărcare colecții';
      setCollectionsError(msg);
      toast.error(msg);
    } finally {
      setCollectionsLoading(false);
    }
  }, [
    api,
    page,
    limit,
    search,
    type,
    hasTaxonomy,
    hasTranslation,
    hasDescription,
    hasImage,
    menuLevel,
    menuAiState,
    sortBy,
    sortDir,
  ]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const result = await api.getApi<CollectionsStats>('/collections/stats');
      setStats(result);
    } catch {
      // best-effort
    } finally {
      setStatsLoading(false);
    }
  }, [api]);

  const loadPendingCounts = useCallback(async () => {
    try {
      const result = await api.getApi<{ count: number; byType: PendingChangesByType }>(
        '/collections/pending-changes/count'
      );
      setPendingChangesCount(result.count ?? 0);
      setPendingChangesByType(
        result.byType ?? {
          field_update: 0,
          taxonomy_assign: 0,
          taxonomy_unassign: 0,
          menu_assign: 0,
          product_dissociate: 0,
          metafield_definition_create: 0,
        }
      );
    } catch {
      setPendingChangesCount(0);
      setPendingChangesByType({
        field_update: 0,
        taxonomy_assign: 0,
        taxonomy_unassign: 0,
        menu_assign: 0,
        product_dissociate: 0,
        metafield_definition_create: 0,
      });
    }
  }, [api]);

  const loadPendingChanges = useCallback(async () => {
    setPendingChangesLoading(true);
    try {
      const result = await api.getApi<{
        changes: PendingChangeRow[];
        byType: PendingChangesByType;
      }>('/collections/pending-changes');
      setPendingChangesRows(result.changes ?? []);
      setPendingChangesByType(
        result.byType ?? {
          field_update: 0,
          taxonomy_assign: 0,
          taxonomy_unassign: 0,
          menu_assign: 0,
          product_dissociate: 0,
          metafield_definition_create: 0,
        }
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Eroare la încărcarea modificărilor în așteptare'
      );
    } finally {
      setPendingChangesLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    if (!selectedCollection) return;
    const updated = collections.find((c) => c.id === selectedCollection.id);
    if (updated && updated !== selectedCollection) {
      setSelectedCollection(updated);
    }
  }, [collections, selectedCollection]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadPendingCounts();
  }, [loadPendingCounts]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadPendingCounts();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadPendingCounts]);

  useEffect(() => {
    if (pendingChangesOpen) {
      void loadPendingChanges();
    }
  }, [loadPendingChanges, pendingChangesOpen]);

  const stopElapsedTicker = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTicker = useCallback((startedAtMs: number) => {
    syncStartRef.current = startedAtMs;
    setSyncElapsedMs(Math.max(0, Date.now() - startedAtMs));
    if (elapsedTimerRef.current) return;
    elapsedTimerRef.current = setInterval(() => {
      if (syncStartRef.current == null) return;
      setSyncElapsedMs(Math.max(0, Date.now() - syncStartRef.current));
    }, 1000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    stopElapsedTicker();
  }, [stopElapsedTicker]);

  const pollSyncStatus = useCallback(async () => {
    try {
      const result = await api.getApi<SyncProgress>('/collections/sync/status');
      setSyncState(result);

      const previousStatus = lastSyncStatusRef.current;
      lastSyncStatusRef.current = result.status;

      if (isRunningSyncStatus(result.status)) {
        const startedAt =
          result.processedOn != null
            ? new Date(result.processedOn).getTime()
            : result.createdAt != null
              ? new Date(result.createdAt).getTime()
              : null;
        if (startedAt != null && Number.isFinite(startedAt)) {
          startElapsedTicker(startedAt);
        } else if (syncStartRef.current != null) {
          startElapsedTicker(syncStartRef.current);
        } else {
          startElapsedTicker(Date.now());
        }
      }

      if (result.status === 'completed') {
        stopPolling();
        if (previousStatus !== 'completed') {
          void loadCollections();
          void loadStats();
          void loadPendingCounts();
        }
        if (isRunningSyncStatus(previousStatus)) {
          toast.success('Sincronizare completă');
        }
      } else if (result.status === 'failed') {
        stopPolling();
        if (isRunningSyncStatus(previousStatus)) {
          toast.error(result.failedReason ?? 'Sincronizare eșuată');
        }
      }
      return result;
    } catch {
      // ignore polling errors
      return null;
    }
  }, [api, loadCollections, loadStats, startElapsedTicker, stopPolling]);

  const startPollingLoop = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      void pollSyncStatus();
    }, 1500);
  }, [pollSyncStatus]);

  const startSync = useCallback(async () => {
    try {
      await api.postApi<{ queued: boolean; jobId: string }, Record<string, unknown>>(
        '/collections/sync',
        {}
      );
      setSyncState({ status: 'waiting', progress: null });
      setSyncPanelHidden(false);
      lastSyncStatusRef.current = 'waiting';
      stopPolling();
      startElapsedTicker(Date.now());
      void pollSyncStatus();
      startPollingLoop();
      toast.success('Sincronizare pornită');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la pornirea sincronizării');
    }
  }, [api, pollSyncStatus, startElapsedTicker, startPollingLoop, stopPolling]);

  useEffect(() => {
    void (async () => {
      const result = await pollSyncStatus();
      if (result && isRunningSyncStatus(result.status)) {
        startPollingLoop();
      }
    })();

    return () => stopPolling();
  }, [pollSyncStatus, startPollingLoop, stopPolling]);

  const updateSearchParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (!value || value === 'all') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      if (key !== 'page') {
        next.delete('page');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const set = new Set(prev);
      if (set.has(id)) {
        set.delete(id);
      } else {
        set.add(id);
      }
      return Array.from(set);
    });
    setSelectAllMode(null);
  }, []);

  const handleToggleAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(collections.map((c) => c.id));
        setSelectAllMode('page');
      } else {
        setSelectedIds([]);
        setSelectAllMode(null);
      }
    },
    [collections]
  );

  const handleExtendSelection = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (type !== 'all') params.set('type', type);
      if (hasTaxonomy !== 'all') params.set('hasTaxonomy', hasTaxonomy);
      if (hasTranslation !== 'all') params.set('hasTranslation', hasTranslation);
      if (hasDescription !== 'all') params.set('hasDescription', hasDescription);
      if (hasImage !== 'all') params.set('hasImage', hasImage);
      if (menuLevel !== 'all') params.set('menuLevel', menuLevel);
      if (menuAiState !== 'all') params.set('menuAiState', menuAiState);

      const result = await api.getApi<{ ids: string[]; total: number }>(
        `/collections/all-ids?${params.toString()}`
      );
      setSelectedIds(result.ids);
      setSelectAllMode('all');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la extinderea selecției');
    }
  }, [
    api,
    search,
    type,
    hasTaxonomy,
    hasTranslation,
    hasDescription,
    hasImage,
    menuLevel,
    menuAiState,
  ]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectAllMode(null);
  }, []);

  const handleBulkAssignTaxonomy = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setBulkTaxonomyLoading(true);
    setBulkRunning(true);
    setBulkProgress([]);

    try {
      await api.streamPost(
        '/collections/bulk/assign-taxonomy-ai',
        { collectionIds: selectedIds, source: 'ai_taxonomy' },
        (event) => {
          const type = event['type'] as string;

          if (type === 'collection_start') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            setBulkProgress((prev) => [
              ...prev.map((e) => (e.finalStatus === 'running' ? { ...e, expanded: false } : e)),
              {
                collectionId: cId,
                collectionTitle: cTitle,
                steps: [],
                finalStatus: 'running',
                resultMessage: null,
                expanded: true,
                consensusMethod: null,
                consensusScore: null,
              },
            ]);
          }

          if (type === 'collection_progress') {
            const cId = event['collectionId'] as string;
            const step = event['step'] as string;
            const message = event['message'] as string;
            const status = (event['status'] as string) === 'done' ? 'done' : 'in_progress';
            setBulkProgress((prev) =>
              prev.map((entry) => {
                if (entry.collectionId !== cId) return entry;
                const existing = entry.steps.findIndex((s) => s.step === step);
                if (existing >= 0) {
                  const updated = [...entry.steps];
                  updated[existing] = { step, message, status };
                  return { ...entry, steps: updated };
                }
                return { ...entry, steps: [...entry.steps, { step, message, status }] };
              })
            );
          }

          if (type === 'collection_result') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            const status = event['status'] as 'assigned' | 'low_confidence' | 'error';
            const message = (event['message'] as string) ?? '';
            const consensusMethod = (event['consensusMethod'] as ConsensusMethod | null) ?? null;
            const consensusScore =
              typeof event['consensusScore'] === 'number' ? event['consensusScore'] : null;
            setBulkProgress((prev) => {
              const exists = prev.find((e) => e.collectionId === cId);
              if (exists) {
                return prev.map((e) =>
                  e.collectionId === cId
                    ? {
                        ...e,
                        finalStatus: status,
                        resultMessage: message,
                        expanded: false,
                        consensusMethod,
                        consensusScore,
                      }
                    : e
                );
              }
              return [
                ...prev,
                {
                  collectionId: cId,
                  collectionTitle: cTitle,
                  steps: [],
                  finalStatus: status,
                  resultMessage: message,
                  expanded: false,
                  consensusMethod,
                  consensusScore,
                },
              ];
            });
          }

          if (type === 'bulk_done') {
            setBulkRunning(false);
          }
        }
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la atribuirea taxonomiei');
    } finally {
      setBulkTaxonomyLoading(false);
      setBulkRunning(false);
      setSelectedIds([]);
      setSelectAllMode(null);
      void loadCollections();
      void loadStats();
      void loadPendingCounts();
    }
  }, [api, selectedIds, loadCollections, loadPendingCounts, loadStats]);

  const handleBulkAssignMenu = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setBulkMenuRunning(true);
    setBulkMenuProgress([]);

    try {
      await api.streamPost(
        '/collections/bulk/assign-menu-ai',
        { collectionIds: selectedIds },
        (event) => {
          const type = event['type'] as string;

          if (type === 'menu_assign_collection_start') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            setBulkMenuProgress((prev) => [
              ...prev.map((entry) =>
                entry.finalStatus === 'running' ? { ...entry, expanded: false } : entry
              ),
              {
                collectionId: cId,
                collectionTitle: cTitle,
                steps: [],
                finalStatus: 'running',
                resultMessage: null,
                expanded: true,
                consensusMethod: null,
                consensusScore: null,
              },
            ]);
          }

          if (type === 'menu_assign_progress') {
            const cId = event['collectionId'] as string;
            const step = event['step'] as string;
            const message = event['message'] as string;
            const status: 'in_progress' | 'done' | 'error' =
              (event['status'] as string) === 'done'
                ? 'done'
                : (event['status'] as string) === 'error'
                  ? 'error'
                  : 'in_progress';
            setBulkMenuProgress((prev) =>
              prev.map((entry) => {
                if (entry.collectionId !== cId) return entry;
                const existing = entry.steps.findIndex((s) => s.step === step);
                if (existing >= 0) {
                  const updated = [...entry.steps];
                  updated[existing] = { step, message, status };
                  return { ...entry, steps: updated };
                }
                return { ...entry, steps: [...entry.steps, { step, message, status }] };
              })
            );
          }

          if (type === 'menu_assign_collection_result') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            const rawStatus = event['status'] as
              | 'assigned'
              | 'proposed'
              | 'review_required'
              | 'error';
            const primaryCount = Number(event['primaryCount'] ?? 0);
            const secondaryCount = Number(event['secondaryCount'] ?? 0);
            const message =
              (event['message'] as string) ??
              (rawStatus === 'assigned'
                ? `${primaryCount} primară, ${secondaryCount} secundare`
                : 'review necesar');
            const consensusMethod = (event['consensusMethod'] as ConsensusMethod | null) ?? null;
            const consensusScore =
              typeof event['consensusScore'] === 'number' ? event['consensusScore'] : null;

            setBulkMenuProgress((prev) => {
              const exists = prev.find((entry) => entry.collectionId === cId);
              const nextEntry: BulkCollectionEntry = {
                collectionId: cId,
                collectionTitle: cTitle,
                steps: exists?.steps ?? [],
                finalStatus: rawStatus,
                resultMessage: message,
                expanded: false,
                consensusMethod,
                consensusScore,
              };
              if (exists) {
                return prev.map((entry) => (entry.collectionId === cId ? nextEntry : entry));
              }
              return [...prev, nextEntry];
            });
          }

          if (type === 'menu_assign_done') {
            setBulkMenuRunning(false);
          }
        }
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la asignarea categoriilor AI');
    } finally {
      setBulkMenuRunning(false);
      setSelectedIds([]);
      setSelectAllMode(null);
      void loadCollections();
      void loadStats();
    }
  }, [api, selectedIds, loadCollections, loadStats]);

  const runTranslateStream = useCallback(
    async (body: Record<string, unknown>) => {
      setBulkTranslateLoading(true);
      setTranslateRunning(true);
      setTranslateProgress([]);

      try {
        await api.streamPost('/collections/bulk/translate', body, (event) => {
          const type = event['type'] as string;

          if (type === 'translate_collection_start') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            setTranslateProgress((prev) => [
              ...prev.map((e) => (e.finalStatus === 'running' ? { ...e, expanded: false } : e)),
              {
                collectionId: cId,
                collectionTitle: cTitle,
                steps: [],
                finalStatus: 'running',
                resultMessage: null,
                expanded: true,
                consensusMethod: null,
                consensusScore: null,
              },
            ]);
          }

          if (type === 'translate_progress') {
            const cId = event['collectionId'] as string;
            const step = event['step'] as string;
            const message = event['message'] as string;
            const status: 'in_progress' | 'done' | 'error' =
              (event['status'] as string) === 'done'
                ? 'done'
                : (event['status'] as string) === 'error'
                  ? 'error'
                  : 'in_progress';
            setTranslateProgress((prev) =>
              prev.map((entry) => {
                if (entry.collectionId !== cId) return entry;
                const existing = entry.steps.findIndex((s) => s.step === step);
                if (existing >= 0) {
                  const updated = [...entry.steps];
                  updated[existing] = { step, message, status };
                  return { ...entry, steps: updated };
                }
                return { ...entry, steps: [...entry.steps, { step, message, status }] };
              })
            );
          }

          if (type === 'translate_collection_result') {
            const cId = event['collectionId'] as string;
            const cTitle = event['collectionTitle'] as string;
            const status = event['status'] as string;
            const titleEn = event['titleEn'] as string | undefined;
            const msg = titleEn ? `→ „${titleEn}"` : ((event['message'] as string) ?? 'Eroare');
            const finalStatus: 'assigned' | 'error' =
              status === 'translated' ? 'assigned' : 'error';
            const consensusMethod = (event['consensusMethod'] as ConsensusMethod | null) ?? null;
            const consensusScore =
              typeof event['consensusScore'] === 'number' ? event['consensusScore'] : null;
            setTranslateProgress((prev) => {
              const exists = prev.find((e) => e.collectionId === cId);
              if (exists) {
                return prev.map((e) =>
                  e.collectionId === cId
                    ? {
                        ...e,
                        finalStatus,
                        resultMessage: msg,
                        expanded: false,
                        consensusMethod,
                        consensusScore,
                      }
                    : e
                );
              }
              return [
                ...prev,
                {
                  collectionId: cId,
                  collectionTitle: cTitle,
                  steps: [],
                  finalStatus,
                  resultMessage: msg,
                  expanded: false,
                  consensusMethod,
                  consensusScore,
                },
              ];
            });
          }

          if (type === 'translate_done') {
            setTranslateRunning(false);
          }
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Eroare la traducere');
      } finally {
        setBulkTranslateLoading(false);
        setTranslateRunning(false);
        void loadCollections();
        void loadStats();
      }
    },
    [api, loadCollections, loadStats]
  );

  const handleBulkTranslate = useCallback(async () => {
    await runTranslateStream({});
  }, [runTranslateStream]);

  const handleBulkTranslateSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    await runTranslateStream({ collectionIds: selectedIds, force: true });
    setSelectedIds([]);
    setSelectAllMode(null);
  }, [runTranslateStream, selectedIds]);

  const handleRejectPendingChange = useCallback(
    async (changeId: string) => {
      try {
        await api.postApi(`/collections/pending-changes/${changeId}/reject`, {});
        await Promise.all([loadPendingCounts(), loadPendingChanges()]);
        toast.success('Modificarea a fost respinsă');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Eroare la respingerea modificării');
      }
    },
    [api, loadPendingChanges, loadPendingCounts]
  );

  const handleApprovePendingChanges = useCallback(async () => {
    setPendingChangesApproving(true);
    try {
      await api.postApi('/collections/pending-changes/approve', {});
      await Promise.all([
        loadPendingCounts(),
        loadPendingChanges(),
        loadCollections(),
        loadStats(),
      ]);
      toast.success('Modificările au fost aprobate și trimise în coada de sincronizare');
      setPendingChangesOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la aprobarea modificărilor');
    } finally {
      setPendingChangesApproving(false);
    }
  }, [api, loadCollections, loadPendingChanges, loadPendingCounts, loadStats]);

  const handleSort = useCallback(
    (column: string) => {
      const next = new URLSearchParams(searchParams);
      if (sortBy === column) {
        next.set('sortDir', sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        next.set('sortBy', column);
        next.set('sortDir', 'desc');
      }
      next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams, sortBy, sortDir]
  );

  const allOnPageSelected =
    collections.length > 0 && collections.every((c) => selectedIds.includes(c.id));
  const showExtendBanner = allOnPageSelected && pagination && pagination.total > collections.length;

  const syncPayload = useMemo(() => getSyncPayload(syncState.progress), [syncState.progress]);

  const syncProgress = useMemo(() => {
    if (syncState.status === 'completed') return 100;
    if (!syncState.progress) return 0;
    if (typeof syncState.progress === 'number') return syncState.progress;
    return syncState.progress.percent ?? 0;
  }, [syncState.progress, syncState.status]);

  const syncFetched = useMemo(() => syncPayload?.fetched ?? null, [syncPayload]);

  const syncPhaseLabel = useMemo(() => {
    if (syncState.status === 'waiting') {
      return 'Sincronizare pusă în coadă';
    }
    if (syncState.status === 'delayed') {
      return 'Sincronizare întârziată în coadă';
    }
    if (syncState.status === 'completed') {
      return 'Sincronizare Shopify finalizată';
    }
    if (syncState.status === 'failed') {
      return 'Sincronizare Shopify eșuată';
    }
    if (!syncPayload) {
      return 'Sincronizare în curs...';
    }
    if (syncPayload.phase === 'collections') {
      return syncFetched != null
        ? `Sincronizare colecții... (${syncFetched} importate)`
        : 'Sincronizare colecții...';
    }
    if (syncPayload.phase === 'menus') {
      const current = syncPayload.current;
      const totalMenus = syncPayload.total;
      return current != null && totalMenus != null
        ? `Sincronizare meniuri... (${current}/${totalMenus})`
        : 'Sincronizare meniuri...';
    }
    if (syncPayload.phase === 'hierarchy') {
      return syncPayload.status === 'completed'
        ? 'Corelare ierarhie finalizată'
        : 'Corelare ierarhie...';
    }
    if (syncPayload.phase === 'embedding_menu_items') {
      return syncPayload.menuItemsEmbedded != null && syncPayload.menuItemsTotal != null
        ? `Generare embeddings meniu... (${syncPayload.menuItemsEmbedded}/${syncPayload.menuItemsTotal})`
        : 'Generare embeddings meniu...';
    }
    if (syncPayload.phase === 'done') {
      return 'Sincronizare finalizată';
    }
    return 'Sincronizare în curs...';
  }, [syncFetched, syncPayload, syncState.status]);

  const syncSteps = useMemo(() => buildSyncSteps(syncState), [syncState]);

  const lastSyncLabel = useMemo(() => {
    if (!stats?.lastSyncedAt) return 'Ultima sincronizare completă: încă nu există.';
    return `Ultima sincronizare completă: ${formatAbsoluteDateTime(stats.lastSyncedAt)}`;
  }, [stats?.lastSyncedAt]);

  const canRestoreSyncPanel = syncState.status !== 'idle' && syncPanelHidden;

  const syncMetaLabel = useMemo(() => {
    if (syncState.status === 'failed') {
      return syncState.failedReason ?? 'Worker-ul a raportat o eroare.';
    }
    if (syncState.status === 'completed') {
      return syncState.finishedOn
        ? `Finalizată la ${formatAbsoluteDateTime(syncState.finishedOn)}`
        : 'Datele din tabel și KPI au fost reîmprospătate.';
    }
    if (syncState.status === 'waiting' || syncState.status === 'delayed') {
      return syncState.createdAt
        ? `Job creat la ${formatAbsoluteDateTime(syncState.createdAt)}`
        : 'Job-ul așteaptă procesarea în worker.';
    }
    if (syncPayload?.phase === 'done') {
      return 'Sincronizarea a intrat în faza finală de închidere.';
    }
    return 'Import live din Shopify cu urmărire pe faze.';
  }, [
    syncPayload?.phase,
    syncState.createdAt,
    syncState.failedReason,
    syncState.finishedOn,
    syncState.status,
  ]);

  const syncDurationLabel = useMemo(() => {
    if (syncElapsedMs > 0) return formatDuration(syncElapsedMs);
    if (!syncState.processedOn || !syncState.finishedOn) return '—';

    const startedAtMs = new Date(syncState.processedOn).getTime();
    const finishedAtMs = new Date(syncState.finishedOn).getTime();
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) return '—';

    const durationMs = Math.max(0, finishedAtMs - startedAtMs);
    return durationMs > 0 ? formatDuration(durationMs) : '—';
  }, [syncElapsedMs, syncState.finishedOn, syncState.processedOn]);

  const [contentRef, contentVisible] = useScrollReveal<HTMLDivElement>({
    rootMargin: '0px 0px -40px 0px',
  });

  return (
    <div
      ref={contentRef}
      className="space-y-6"
      style={
        reducedMotion
          ? undefined
          : {
              animation: contentVisible ? 'fadeSlideUp 0.4s ease-out both' : 'none',
            }
      }
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Breadcrumbs items={breadcrumbs} />
          <h1 className="text-2xl font-bold tracking-tight text-foreground motion-safe:animate-[fadeSlideUp_0.5s_ease-out_both]">
            Gestionare Colecții
          </h1>
          <p className="text-sm text-muted">
            Sincronizează, clasifică și gestionează colecțiile Shopify.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <span className="inline-flex items-center gap-2">
            {pendingChangesCount > 0 && (
              <Button variant="secondary" onClick={() => setPendingChangesOpen(true)}>
                <Upload className="mr-2 size-4" />
                {pendingChangesCount} modificări de sincronizat
              </Button>
            )}
            <Button variant="secondary" onClick={() => void startSync()} disabled={isSyncing}>
              <RefreshCw className={`mr-2 size-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Sincronizare...' : 'Sincronizează din Shopify'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleBulkTranslate()}
              disabled={bulkTranslateLoading}
            >
              <Languages className={`mr-2 size-4 ${translateRunning ? 'animate-pulse' : ''}`} />
              {translateRunning
                ? `Se traduce (${translateProgress.filter((e) => e.finalStatus !== 'running').length}/${translateProgress.length})...`
                : 'Traduce EN'}
            </Button>
            <InfoTooltip title="Sincronizare & traducere" side="bottom">
              Sincronizează colecțiile din Shopify, apoi traduce titlurile în engleză pentru o
              atribuire precisă a taxonomiei AI. Traducerea se face o singură dată.
            </InfoTooltip>
          </span>
          <button
            type="button"
            className={`text-xs ${
              canRestoreSyncPanel
                ? 'text-primary underline decoration-dotted underline-offset-2 hover:text-primary/80'
                : 'cursor-default text-muted'
            }`}
            onClick={() => {
              if (canRestoreSyncPanel) setSyncPanelHidden(false);
            }}
          >
            {lastSyncLabel}
          </button>
        </div>
      </header>

      {/* Stats Cards */}
      {(() => {
        const total = stats?.total ?? 0;
        const splitPairs: {
          top: {
            label: string;
            value: number;
            icon: typeof Tag;
            filterKey: string;
            filterParam: string;
            filterValue: string;
          };
          bottom: {
            label: string;
            value: number;
            icon: typeof CircleOff;
            filterKey: string;
            filterParam: string;
            filterValue: string;
          };
          delay: number;
        }[] = [
          {
            top: {
              label: 'Total colecții',
              value: total,
              icon: FolderOpen,
              filterKey: 'all',
              filterParam: '',
              filterValue: '',
            },
            bottom: {
              label: 'Cu imagine',
              value: stats?.withImage ?? 0,
              icon: ImageIcon,
              filterKey: 'withImage',
              filterParam: 'hasImage',
              filterValue: 'true',
            },
            delay: 0,
          },
          {
            top: {
              label: 'Manuale',
              value: stats?.manual ?? 0,
              icon: Layers,
              filterKey: 'manual',
              filterParam: 'type',
              filterValue: 'MANUAL',
            },
            bottom: {
              label: 'Smart',
              value: stats?.smart ?? 0,
              icon: Sparkles,
              filterKey: 'smart',
              filterParam: 'type',
              filterValue: 'SMART',
            },
            delay: 1,
          },
          {
            top: {
              label: 'Cu taxonomie',
              value: stats?.withTaxonomy ?? 0,
              icon: Tag,
              filterKey: 'withTaxonomy',
              filterParam: 'hasTaxonomy',
              filterValue: 'true',
            },
            bottom: {
              label: 'Fără taxonomie',
              value: total - (stats?.withTaxonomy ?? 0),
              icon: CircleOff,
              filterKey: 'withoutTaxonomy',
              filterParam: 'hasTaxonomy',
              filterValue: 'false',
            },
            delay: 2,
          },
          {
            top: {
              label: 'Traduse EN',
              value: stats?.translated ?? 0,
              icon: Languages,
              filterKey: 'translated',
              filterParam: 'hasTranslation',
              filterValue: 'true',
            },
            bottom: {
              label: 'Fără traducere',
              value: total - (stats?.translated ?? 0),
              icon: CircleOff,
              filterKey: 'untranslated',
              filterParam: 'hasTranslation',
              filterValue: 'false',
            },
            delay: 3,
          },
          {
            top: {
              label: 'Cu descriere',
              value: stats?.withDescription ?? 0,
              icon: FileText,
              filterKey: 'withDescription',
              filterParam: 'hasDescription',
              filterValue: 'true',
            },
            bottom: {
              label: 'Fără descriere',
              value: total - (stats?.withDescription ?? 0),
              icon: CircleOff,
              filterKey: 'withoutDescription',
              filterParam: 'hasDescription',
              filterValue: 'false',
            },
            delay: 4,
          },
          {
            top: {
              label: 'În meniu',
              value: stats?.inMenu ?? 0,
              icon: GitBranch,
              filterKey: 'inMenu',
              filterParam: 'menuLevel',
              filterValue: 'in_menu',
            },
            bottom: {
              label: 'Neclasificate',
              value: stats?.notInMenu ?? 0,
              icon: CircleOff,
              filterKey: 'notInMenu',
              filterParam: 'menuLevel',
              filterValue: 'none',
            },
            delay: 5,
          },
        ];

        const isCardActive = (filterKey: string) =>
          (filterKey === 'all' &&
            type === 'all' &&
            hasTaxonomy === 'all' &&
            hasTranslation === 'all' &&
            hasDescription === 'all' &&
            hasImage === 'all' &&
            menuLevel === 'all' &&
            menuAiState === 'all') ||
          (filterKey === 'manual' && type === 'MANUAL') ||
          (filterKey === 'smart' && type === 'SMART') ||
          (filterKey === 'withTaxonomy' && hasTaxonomy === 'true') ||
          (filterKey === 'withoutTaxonomy' && hasTaxonomy === 'false') ||
          (filterKey === 'translated' && hasTranslation === 'true') ||
          (filterKey === 'untranslated' && hasTranslation === 'false') ||
          (filterKey === 'withDescription' && hasDescription === 'true') ||
          (filterKey === 'withoutDescription' && hasDescription === 'false') ||
          (filterKey === 'withImage' && hasImage === 'true') ||
          (filterKey === 'withoutImage' && hasImage === 'false') ||
          (filterKey === 'inMenu' && menuLevel === 'in_menu') ||
          (filterKey === 'notInMenu' && menuLevel === 'none');

        const applyFilter = (filterParam?: string, filterValue?: string) => {
          const next = new URLSearchParams(searchParams);
          next.delete('type');
          next.delete('hasTaxonomy');
          next.delete('hasTranslation');
          next.delete('hasDescription');
          next.delete('hasImage');
          next.delete('menuLevel');
          next.delete('menuAiState');
          next.set('page', '1');
          if (filterParam && filterValue) next.set(filterParam, filterValue);
          setSearchParams(next);
        };

        const cardBase = (active: boolean) =>
          `cursor-pointer overflow-hidden rounded-xl border shadow-[var(--shadow-sm)] backdrop-blur-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] ${
            active
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-border bg-card/80 hover:border-border'
          }`;

        const halfCardBase = (active: boolean) =>
          `cursor-pointer px-4 py-2 transition-colors duration-200 ${
            active ? 'bg-primary/5' : 'hover:bg-subtle'
          }`;

        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {splitPairs.map((pair) => {
              const topActive = isCardActive(pair.top.filterKey);
              const bottomActive = isCardActive(pair.bottom.filterKey);
              const wrapperActive = topActive || bottomActive;
              return (
                <div
                  key={pair.top.filterKey}
                  className={`${cardBase(wrapperActive)} flex flex-col`}
                  style={
                    reducedMotion
                      ? undefined
                      : {
                          animation: statsLoading
                            ? 'none'
                            : `fadeSlideUp 0.4s ease-out ${pair.delay * 0.1}s both`,
                        }
                  }
                >
                  <div
                    className={`${halfCardBase(topActive)} flex-1 rounded-t-xl`}
                    onClick={() => applyFilter(pair.top.filterParam, pair.top.filterValue)}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wider ${topActive ? 'text-primary' : 'text-muted'}`}
                      >
                        {pair.top.label}
                      </span>
                      <pair.top.icon
                        className={`size-3.5 ${topActive ? 'text-primary' : 'text-muted'}`}
                      />
                    </div>
                    <p
                      className={`mt-1 text-xl font-bold ${topActive ? 'text-primary' : 'text-foreground'}`}
                    >
                      {statsLoading ? (
                        <span className="inline-block h-6 w-12 animate-pulse rounded bg-subtle" />
                      ) : (
                        pair.top.value.toLocaleString('ro-RO')
                      )}
                    </p>
                  </div>
                  <div className="border-t border-border" />
                  <div
                    className={`${halfCardBase(bottomActive)} flex-1 rounded-b-xl`}
                    onClick={() => applyFilter(pair.bottom.filterParam, pair.bottom.filterValue)}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wider ${bottomActive ? 'text-warning' : 'text-muted'}`}
                      >
                        {pair.bottom.label}
                      </span>
                      <pair.bottom.icon
                        className={`size-3.5 ${bottomActive ? 'text-warning' : 'text-muted'}`}
                      />
                    </div>
                    <p
                      className={`mt-1 text-xl font-bold ${bottomActive ? 'text-warning' : 'text-muted'}`}
                    >
                      {statsLoading ? (
                        <span className="inline-block h-6 w-12 animate-pulse rounded bg-subtle" />
                      ) : (
                        pair.bottom.value.toLocaleString('ro-RO')
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Sync Progress */}
      {showSyncPanel && (
        <div
          className={`rounded-xl border p-4 shadow-(--shadow-sm) ${
            syncState.status === 'failed'
              ? 'border-error/30 bg-error/10'
              : syncState.status === 'completed'
                ? 'border-success/30 bg-success/5'
                : 'border-primary/30 bg-primary/5'
          }`}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {syncState.status === 'completed' ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : syncState.status === 'failed' ? (
                  <AlertTriangle className="size-4 text-error" />
                ) : syncState.status === 'waiting' || syncState.status === 'delayed' ? (
                  <Clock3 className="size-4 text-primary" />
                ) : (
                  <LoaderCircle className="size-4 animate-spin text-primary" />
                )}
                <span
                  className={`text-sm font-semibold ${
                    syncState.status === 'failed'
                      ? 'text-error'
                      : syncState.status === 'completed'
                        ? 'text-success'
                        : 'text-primary'
                  }`}
                >
                  {syncPhaseLabel}
                </span>
                <button
                  type="button"
                  className="ml-1 inline-flex size-7 items-center justify-center rounded-md text-muted transition hover:bg-card/70 hover:text-foreground"
                  onClick={() => setSyncPanelHidden(true)}
                  aria-label="Ascunde panoul de sincronizare"
                  title="Ascunde"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">{syncMetaLabel}</p>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <div className="text-right">
                <div className="font-semibold text-foreground">{Math.round(syncProgress)}%</div>
                <div className="text-muted">progres</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-foreground">{syncDurationLabel}</div>
                <div className="text-muted">durată</div>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <ProgressBar progress={syncProgress} />
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-white/60 bg-card/70 px-3 py-2 text-xs">
              <div className="text-muted">Colecții importate</div>
              <div className="mt-1 font-semibold text-foreground">
                {syncFetched != null ? syncFetched.toLocaleString('ro-RO') : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-white/60 bg-card/70 px-3 py-2 text-xs">
              <div className="text-muted">Itemi meniu</div>
              <div className="mt-1 font-semibold text-foreground">
                {syncPayload?.menuItems != null
                  ? syncPayload.menuItems.toLocaleString('ro-RO')
                  : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-white/60 bg-card/70 px-3 py-2 text-xs">
              <div className="text-muted">Relații corelate</div>
              <div className="mt-1 font-semibold text-foreground">
                {syncPayload?.correlated != null
                  ? syncPayload.correlated.toLocaleString('ro-RO')
                  : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-white/60 bg-card/70 px-3 py-2 text-xs">
              <div className="text-muted">Embeddings meniu</div>
              <div className="mt-1 font-semibold text-foreground">
                {syncPayload?.menuItemsEmbedded != null && syncPayload?.menuItemsTotal != null
                  ? `${syncPayload.menuItemsEmbedded.toLocaleString('ro-RO')}/${syncPayload.menuItemsTotal.toLocaleString('ro-RO')}`
                  : '—'}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {syncSteps.map((step) => (
              <div
                key={step.key}
                className="flex items-start gap-3 rounded-lg border border-white/60 bg-card/70 px-3 py-2"
              >
                <span className="mt-0.5">
                  {step.status === 'done' ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : step.status === 'error' ? (
                    <AlertTriangle className="size-4 text-error" />
                  ) : step.status === 'active' ? (
                    <LoaderCircle className="size-4 animate-spin text-primary" />
                  ) : (
                    <Clock3 className="size-4 text-muted" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{step.label}</div>
                  <div className="text-xs text-muted">{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(val) => updateSearchParam('search', val)}
          placeholder="Caută colecții..."
          loading={collectionsLoading}
        />
        <Select
          options={COLLECTION_TYPE_OPTIONS}
          value={type}
          onChange={(e) => updateSearchParam('type', e.target.value)}
        />
        <Select
          options={TAXONOMY_OPTIONS}
          value={hasTaxonomy}
          onChange={(e) => updateSearchParam('hasTaxonomy', e.target.value)}
        />
        <Select
          options={MENU_LEVEL_OPTIONS}
          value={menuLevel}
          onChange={(e) => updateSearchParam('menuLevel', e.target.value)}
        />
        <Select
          options={MENU_AI_STATE_OPTIONS}
          value={menuAiState}
          onChange={(e) => updateSearchParam('menuAiState', e.target.value)}
        />
        <Select
          options={PAGE_SIZE_OPTIONS}
          value={String(limit)}
          onChange={(e) => updateSearchParam('limit', e.target.value)}
        />
      </div>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <div className="sticky top-0 z-30 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 shadow-(--shadow-sm)">
          <span className="text-sm font-medium text-primary">
            {selectedIds.length}{' '}
            {selectedIds.length === 1 ? 'colecție selectată' : 'colecții selectate'}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void handleBulkAssignTaxonomy()}
              disabled={bulkTaxonomyLoading || bulkMenuRunning}
            >
              {bulkRunning
                ? `Se atribuie (${bulkProgress.filter((e) => e.finalStatus !== 'running').length}/${bulkProgress.length})...`
                : 'Atribuie taxonomie AI'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleBulkAssignMenu()}
              disabled={bulkMenuRunning || bulkRunning || bulkTranslateLoading}
            >
              {bulkMenuRunning
                ? `Categorii AI (${bulkMenuProgress.filter((e) => e.finalStatus !== 'running').length}/${bulkMenuProgress.length})...`
                : 'Categorii/meniu AI'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleBulkTranslateSelected()}
              disabled={bulkTranslateLoading || bulkMenuRunning}
            >
              <Languages className={`mr-1.5 size-3.5 ${translateRunning ? 'animate-pulse' : ''}`} />
              {translateRunning
                ? `Se traduce (${translateProgress.filter((e) => e.finalStatus !== 'running').length}/${translateProgress.length})...`
                : 'Traduce EN'}
            </Button>
            <Button variant="ghost" onClick={handleClearSelection}>
              Șterge selecția
            </Button>
          </div>
        </div>
      )}

      {/* Select All Banner */}
      {showExtendBanner && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2 text-center text-sm">
          {selectAllMode === 'all' ? (
            <>
              <span className="text-warning">
                Toate cele {pagination.total.toLocaleString('ro-RO')} colecții sunt selectate.
              </span>{' '}
              <button
                type="button"
                className="font-medium text-warning underline hover:text-warning"
                onClick={() => handleToggleAll(true)}
              >
                Selectează doar pagina curentă
              </button>
            </>
          ) : (
            <>
              <span className="text-warning">
                Toate cele {collections.length} colecții de pe pagină sunt selectate.
              </span>{' '}
              <button
                type="button"
                className="font-medium text-warning underline hover:text-warning"
                onClick={() => void handleExtendSelection()}
              >
                Extinde selecția la toate cele {pagination.total.toLocaleString('ro-RO')} colecții
              </button>
            </>
          )}
        </div>
      )}

      {/* Bulk AI Taxonomy Progress Panel */}
      {bulkProgress.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {bulkRunning
                ? 'Atribuire taxonomii AI în curs...'
                : `Atribuire completă — ${bulkProgress.filter((e) => e.finalStatus === 'assigned').length} atribuite, ${bulkProgress.filter((e) => e.finalStatus === 'low_confidence').length} conf. scăzută, ${bulkProgress.filter((e) => e.finalStatus === 'error').length} erori`}
            </h3>
            {!bulkRunning && (
              <button
                type="button"
                onClick={() => setBulkProgress([])}
                className="text-xs text-muted hover:text-muted"
              >
                Închide
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-100 overflow-y-auto">
            {bulkProgress.map((entry) => (
              <div key={entry.collectionId} className="rounded border border-border">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-subtle"
                  onClick={() =>
                    setBulkProgress((prev) =>
                      prev.map((e) =>
                        e.collectionId === entry.collectionId ? { ...e, expanded: !e.expanded } : e
                      )
                    )
                  }
                >
                  <span className="shrink-0">
                    {entry.finalStatus === 'running' && (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    )}
                    {entry.finalStatus === 'assigned' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-[9px] text-success-foreground">
                        &#10003;
                      </span>
                    )}
                    {entry.finalStatus === 'low_confidence' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-warning/50 text-[9px] text-warning-foreground">
                        !
                      </span>
                    )}
                    {entry.finalStatus === 'error' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-error/50 text-[9px] text-error-foreground">
                        &#10007;
                      </span>
                    )}
                  </span>
                  <span className="flex-1 truncate font-medium text-foreground">
                    {entry.collectionTitle}
                  </span>
                  {entry.consensusScore != null && (
                    <InfoTooltip
                      title={buildConsensusTooltip(entry.consensusMethod, entry.consensusScore)}
                      side="bottom"
                    >
                      <Badge tone={consensusBadgeTone(entry.consensusScore)}>
                        {formatConsensusScore(entry.consensusScore)}
                      </Badge>
                    </InfoTooltip>
                  )}
                  {entry.resultMessage && !entry.expanded && (
                    <span
                      className={`truncate text-xs ${entry.finalStatus === 'assigned' ? 'text-success' : entry.finalStatus === 'error' ? 'text-error' : 'text-warning'}`}
                    >
                      {entry.resultMessage}
                    </span>
                  )}
                  <span
                    className={`text-xs text-muted transition-transform ${entry.expanded ? 'rotate-180' : ''}`}
                  >
                    &#9660;
                  </span>
                </button>
                {entry.expanded && entry.steps.length > 0 && (
                  <div className="border-t border-border bg-subtle px-3 py-2">
                    <ul className="space-y-1">
                      {entry.steps.map((s, si) => (
                        <li key={`${s.step}-${si}`} className="flex items-start gap-1.5 text-xs">
                          <span className="mt-0.5 shrink-0">
                            {s.status === 'in_progress' && (
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
                            )}
                            {s.status === 'done' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-success text-[8px] text-success-foreground">
                                &#10003;
                              </span>
                            )}
                            {s.status === 'error' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-error/50 text-[8px] text-error-foreground">
                                &#10007;
                              </span>
                            )}
                          </span>
                          <span className={s.status === 'error' ? 'text-error' : 'text-muted'}>
                            {s.message}
                          </span>
                        </li>
                      ))}
                      {entry.resultMessage && (
                        <li
                          className={`mt-1 text-xs font-medium ${entry.finalStatus === 'assigned' ? 'text-success' : entry.finalStatus === 'error' ? 'text-error' : 'text-warning'}`}
                        >
                          {entry.resultMessage}
                        </li>
                      )}
                      {entry.consensusScore != null && (
                        <li className="mt-1 text-xs text-muted">
                          Consens: {formatConsensusMethod(entry.consensusMethod)} · scor{' '}
                          {formatConsensusScore(entry.consensusScore)}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bulk Menu AI Progress Panel */}
      {bulkMenuProgress.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {bulkMenuRunning
                ? 'Asignare categorii/meniu AI în curs...'
                : `Asignare completă — ${bulkMenuProgress.filter((e) => e.finalStatus === 'assigned').length} atribuite, ${bulkMenuProgress.filter((e) => e.finalStatus === 'proposed' || e.finalStatus === 'review_required').length} propuse, ${bulkMenuProgress.filter((e) => e.finalStatus === 'error').length} erori`}
            </h3>
            {!bulkMenuRunning && (
              <button
                type="button"
                onClick={() => setBulkMenuProgress([])}
                className="text-xs text-muted hover:text-muted"
              >
                Închide
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-100 overflow-y-auto">
            {bulkMenuProgress.map((entry) => (
              <div key={entry.collectionId} className="rounded border border-border">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-subtle"
                  onClick={() =>
                    setBulkMenuProgress((prev) =>
                      prev.map((e) =>
                        e.collectionId === entry.collectionId ? { ...e, expanded: !e.expanded } : e
                      )
                    )
                  }
                >
                  <span className="shrink-0">
                    {entry.finalStatus === 'running' && (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    )}
                    {entry.finalStatus === 'assigned' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-[9px] text-success-foreground">
                        &#10003;
                      </span>
                    )}
                    {(entry.finalStatus === 'proposed' ||
                      entry.finalStatus === 'review_required') && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-warning/50 text-[9px] text-warning-foreground">
                        !
                      </span>
                    )}
                    {entry.finalStatus === 'error' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-error/50 text-[9px] text-error-foreground">
                        &#10007;
                      </span>
                    )}
                  </span>
                  <span className="flex-1 truncate font-medium text-foreground">
                    {entry.collectionTitle}
                  </span>
                  {entry.consensusScore != null && (
                    <InfoTooltip
                      title={buildConsensusTooltip(entry.consensusMethod, entry.consensusScore)}
                      side="bottom"
                    >
                      <Badge tone={consensusBadgeTone(entry.consensusScore)}>
                        {formatConsensusScore(entry.consensusScore)}
                      </Badge>
                    </InfoTooltip>
                  )}
                  {entry.resultMessage && !entry.expanded && (
                    <span
                      className={`truncate text-xs ${
                        entry.finalStatus === 'assigned'
                          ? 'text-success'
                          : entry.finalStatus === 'error'
                            ? 'text-error'
                            : 'text-warning'
                      }`}
                    >
                      {entry.resultMessage}
                    </span>
                  )}
                  <span
                    className={`text-xs text-muted transition-transform ${entry.expanded ? 'rotate-180' : ''}`}
                  >
                    &#9660;
                  </span>
                </button>
                {entry.expanded && entry.steps.length > 0 && (
                  <div className="border-t border-border bg-subtle px-3 py-2">
                    <ul className="space-y-1">
                      {entry.steps.map((s, si) => (
                        <li key={`${s.step}-${si}`} className="flex items-start gap-1.5 text-xs">
                          <span className="mt-0.5 shrink-0">
                            {s.status === 'in_progress' && (
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
                            )}
                            {s.status === 'done' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-success text-[8px] text-success-foreground">
                                &#10003;
                              </span>
                            )}
                            {s.status === 'error' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-error/50 text-[8px] text-error-foreground">
                                &#10007;
                              </span>
                            )}
                          </span>
                          <span className={s.status === 'error' ? 'text-error' : 'text-muted'}>
                            {s.message}
                          </span>
                        </li>
                      ))}
                      {entry.resultMessage && (
                        <li
                          className={`mt-1 text-xs font-medium ${
                            entry.finalStatus === 'assigned'
                              ? 'text-success'
                              : entry.finalStatus === 'error'
                                ? 'text-error'
                                : 'text-warning'
                          }`}
                        >
                          {entry.resultMessage}
                        </li>
                      )}
                      {entry.consensusScore != null && (
                        <li className="mt-1 text-xs text-muted">
                          Consens: {formatConsensusMethod(entry.consensusMethod)} · scor{' '}
                          {formatConsensusScore(entry.consensusScore)}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bulk Translate Progress Panel */}
      {translateProgress.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {translateRunning
                ? 'Traducere în curs...'
                : `Traducere completă — ${translateProgress.filter((e) => e.finalStatus === 'assigned').length} traduse, ${translateProgress.filter((e) => e.finalStatus === 'error').length} erori`}
            </h3>
            {!translateRunning && (
              <button
                type="button"
                onClick={() => setTranslateProgress([])}
                className="text-xs text-muted hover:text-muted"
              >
                Închide
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-100 overflow-y-auto">
            {translateProgress.map((entry) => (
              <div key={entry.collectionId} className="rounded border border-border">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-subtle"
                  onClick={() =>
                    setTranslateProgress((prev) =>
                      prev.map((e) =>
                        e.collectionId === entry.collectionId ? { ...e, expanded: !e.expanded } : e
                      )
                    )
                  }
                >
                  <span className="shrink-0">
                    {entry.finalStatus === 'running' && (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    )}
                    {entry.finalStatus === 'assigned' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-[9px] text-success-foreground">
                        &#10003;
                      </span>
                    )}
                    {entry.finalStatus === 'error' && (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-error/50 text-[9px] text-error-foreground">
                        &#10007;
                      </span>
                    )}
                  </span>
                  <span className="flex-1 truncate font-medium text-foreground">
                    {entry.collectionTitle}
                  </span>
                  {entry.consensusScore != null && (
                    <InfoTooltip
                      title={buildConsensusTooltip(entry.consensusMethod, entry.consensusScore)}
                      side="bottom"
                    >
                      <Badge tone={consensusBadgeTone(entry.consensusScore)}>
                        {formatConsensusScore(entry.consensusScore)}
                      </Badge>
                    </InfoTooltip>
                  )}
                  {entry.resultMessage && !entry.expanded && (
                    <span
                      className={`truncate text-xs ${entry.finalStatus === 'assigned' ? 'text-success' : 'text-error'}`}
                    >
                      {entry.resultMessage}
                    </span>
                  )}
                  <span
                    className={`text-xs text-muted transition-transform ${entry.expanded ? 'rotate-180' : ''}`}
                  >
                    &#9660;
                  </span>
                </button>
                {entry.expanded && entry.steps.length > 0 && (
                  <div className="border-t border-border bg-subtle px-3 py-2">
                    <ul className="space-y-1">
                      {entry.steps.map((s, si) => (
                        <li key={`${s.step}-${si}`} className="flex items-start gap-1.5 text-xs">
                          <span className="mt-0.5 shrink-0">
                            {s.status === 'in_progress' && (
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
                            )}
                            {s.status === 'done' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-success text-[8px] text-success-foreground">
                                &#10003;
                              </span>
                            )}
                            {s.status === 'error' && (
                              <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-error/50 text-[8px] text-error-foreground">
                                &#10007;
                              </span>
                            )}
                          </span>
                          <span className={s.status === 'error' ? 'text-error' : 'text-muted'}>
                            {s.message}
                          </span>
                        </li>
                      ))}
                      {entry.resultMessage && (
                        <li
                          className={`mt-1 text-xs font-medium ${entry.finalStatus === 'assigned' ? 'text-success' : 'text-error'}`}
                        >
                          {entry.resultMessage}
                        </li>
                      )}
                      {entry.consensusScore != null && (
                        <li className="mt-1 text-xs text-muted">
                          Consens: {formatConsensusMethod(entry.consensusMethod)} · scor{' '}
                          {formatConsensusScore(entry.consensusScore)}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {collectionsLoading
          ? 'Se încarcă...'
          : `${pagination?.total ?? collections.length} colecții găsite`}
      </p>

      {/* Collections Table */}
      {collectionsError ? (
        <ErrorState message={collectionsError} />
      ) : collections.length === 0 && !collectionsLoading ? (
        <EmptyState
          title="Nu există colecții"
          description="Sincronizează din Shopify pentru a importa colecțiile."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-subtle">
              <tr>
                <th className="w-10 px-3 py-3">
                  <Checkbox
                    checked={allOnPageSelected && collections.length > 0}
                    onChange={(e) => handleToggleAll(e.target.checked)}
                  />
                </th>
                {[
                  { key: 'title', label: 'Titlu' },
                  { key: 'collection_type', label: 'Tip' },
                  { key: 'products_count', label: 'Produse' },
                  { key: 'menu_level', label: 'Nivel' },
                  { key: '', label: 'Categorii' },
                  { key: '', label: 'Asocieri meniu AI' },
                  { key: '', label: 'Taxonomie' },
                  { key: 'synced_at', label: 'Sincronizat' },
                ].map((col) => (
                  <th
                    key={col.label}
                    className={`px-3 py-3 text-left font-medium text-muted ${
                      col.key ? 'cursor-pointer select-none hover:text-foreground' : ''
                    }`}
                    onClick={() => col.key && handleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.key && sortBy === col.key && (
                        <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {collectionsLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skel-${i}`}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="h-4 animate-pulse rounded bg-subtle" />
                        </td>
                      ))}
                    </tr>
                  ))
                : collections.map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer transition-colors hover:bg-subtle"
                      onClick={() => setSelectedCollection(c)}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.includes(c.id)}
                          onChange={() => handleToggle(c.id)}
                        />
                      </td>
                      <td className="px-3 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {c.image_url ? (
                            <img src={c.image_url} alt="" className="size-8 rounded object-cover" />
                          ) : (
                            <div className="flex size-8 items-center justify-center rounded bg-subtle">
                              <Package className="size-4 text-muted" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <span className="block truncate">{c.title}</span>
                            {c.title_en && (
                              <span className="block truncate text-xs font-normal italic text-muted">
                                {c.title_en}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={c.collection_type === 'SMART' ? 'info' : 'neutral'}>
                          {c.collection_type}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-muted">
                        {c.products_count.toLocaleString('ro-RO')}
                      </td>
                      <td className="px-3 py-3">
                        {c.menu_level === null ? (
                          <span className="inline-flex rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium text-muted">
                            —
                          </span>
                        ) : c.menu_level === 0 ? (
                          <span className="inline-flex rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                            Root
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Nivel {c.menu_level}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <CategoryTreeCell menuPath={c.menu_path} currentTitle={c.title} />
                      </td>
                      <td className="px-3 py-3">
                        {c.menu_assignment_count > 0 || c.menu_review_count > 0 ? (
                          <div className="space-y-1">
                            <span className="block text-xs text-foreground">
                              {buildMenuAssignmentSummary(c)}
                            </span>
                            {c.menu_review_count > 0 && (
                              <span className="inline-flex rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                                {c.menu_review_count} review
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {c.taxonomy_name ? (
                          <span className="text-success">{c.taxonomy_name}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted">{formatRelativeDate(c.synced_at)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <span className="text-sm text-muted">
                Pagina {pagination.page} din {pagination.totalPages} (
                {pagination.total.toLocaleString('ro-RO')} colecții)
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  disabled={!pagination.hasPrev}
                  onClick={() => updateSearchParam('page', '1')}
                >
                  Prima
                </Button>
                <Button
                  variant="ghost"
                  disabled={!pagination.hasPrev}
                  onClick={() => updateSearchParam('page', String(pagination.page - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="ghost"
                  disabled={!pagination.hasNext}
                  onClick={() => updateSearchParam('page', String(pagination.page + 1))}
                >
                  Următor
                </Button>
                <Button
                  variant="ghost"
                  disabled={!pagination.hasNext}
                  onClick={() => updateSearchParam('page', String(pagination.totalPages))}
                >
                  Ultima
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collection Detail Drawer */}
      <Modal
        open={pendingChangesOpen}
        onClose={() => setPendingChangesOpen(false)}
        className="sm:max-w-4xl"
      >
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Modificări în așteptare</h2>
          <p className="mt-1 text-sm text-muted">
            Revizuiește schimbările locale înainte de sincronizarea în Shopify.
          </p>
        </div>
        <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
          {pendingChangesLoading ? (
            <LoadingState label="Se încarcă modificările..." />
          ) : pendingChangesRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              Nicio modificare în așteptare.
            </div>
          ) : (
            <>
              <PendingChangesSection
                title="Modificări câmpuri"
                rows={pendingChangesRows.filter((row) => row.changeType === 'field_update')}
                onReject={handleRejectPendingChange}
              />
              <PendingChangesSection
                title="Atribuiri taxonomie"
                rows={pendingChangesRows.filter((row) => row.changeType === 'taxonomy_assign')}
                onReject={handleRejectPendingChange}
              />
              <PendingChangesSection
                title="Stergeri taxonomie"
                rows={pendingChangesRows.filter((row) => row.changeType === 'taxonomy_unassign')}
                onReject={handleRejectPendingChange}
              />
              <PendingChangesSection
                title="Asignări meniu"
                rows={pendingChangesRows.filter((row) => row.changeType === 'menu_assign')}
                onReject={handleRejectPendingChange}
              />
              <PendingChangesSection
                title="Dezasocieri produse"
                rows={pendingChangesRows.filter((row) => row.changeType === 'product_dissociate')}
                onReject={handleRejectPendingChange}
              />
              <PendingChangesSection
                title="Definiții metafield"
                rows={pendingChangesRows.filter(
                  (row) => row.changeType === 'metafield_definition_create'
                )}
                onReject={handleRejectPendingChange}
              />
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <div className="text-xs text-muted">
            {pendingChangesByType.field_update} câmpuri, {pendingChangesByType.taxonomy_assign}{' '}
            atribuiri, {pendingChangesByType.taxonomy_unassign} ștergeri taxonomie,{' '}
            {pendingChangesByType.menu_assign} meniuri, {pendingChangesByType.product_dissociate}{' '}
            dezasocieri, {pendingChangesByType.metafield_definition_create} metafields
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPendingChangesOpen(false)}>
              Închide
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleApprovePendingChanges()}
              disabled={pendingChangesApproving || pendingChangesRows.length === 0}
            >
              {pendingChangesApproving ? 'Se aprobă...' : 'Aprobă toate și sincronizează'}
            </Button>
          </div>
        </div>
      </Modal>

      {selectedCollection && (
        <CollectionDetailDrawerInline
          collection={selectedCollection}
          api={api}
          onSelectCollection={setSelectedCollection}
          onClose={() => setSelectedCollection(null)}
          onRefresh={() => {
            void loadCollections();
            void loadStats();
            void loadPendingCounts();
          }}
        />
      )}
    </div>
  );
}

function DetailsTab({
  collection,
  titleEn,
  draftFields,
  dirtyFields,
  savingDetails,
  aiGeneratingField,
  generatingImage,
  approvingImage,
  uploadingImage,
  onDraftFieldChange,
  onAiGenerate,
  onGenerateImage,
  onUploadImage,
  onApproveImage,
  onSaveChanges,
}: {
  collection: CollectionRow;
  titleEn: string | null;
  draftFields: Record<string, string>;
  dirtyFields: string[];
  savingDetails: boolean;
  aiGeneratingField: string | null;
  generatingImage: boolean;
  approvingImage: boolean;
  uploadingImage: boolean;
  onDraftFieldChange: (field: string, value: string) => void;
  onAiGenerate: (field: string) => Promise<void>;
  onGenerateImage: () => Promise<void>;
  onUploadImage: (file: File) => Promise<void>;
  onApproveImage: () => Promise<void>;
  onSaveChanges: () => Promise<void>;
}) {
  const editableFields: {
    key: string;
    label: string;
    editable: boolean;
    aiEnabled: boolean;
    aiMode?: 'generate' | 'translate';
    aiLabel?: string;
    multiline?: boolean;
  }[] = [
    {
      key: 'title',
      label: 'Titlu (RO)',
      editable: true,
      aiEnabled: true,
      aiMode: 'generate',
      aiLabel: 'Generează cu AI',
    },
    {
      key: 'title_en',
      label: 'Titlu (EN)',
      editable: true,
      aiEnabled: true,
      aiMode: 'translate',
      aiLabel: 'Traduce din RO (4 agenți consensus)',
    },
    {
      key: 'description',
      label: 'Descriere (RO)',
      editable: true,
      aiEnabled: true,
      aiMode: 'generate',
      aiLabel: 'Generează cu AI',
      multiline: true,
    },
    {
      key: 'description_en',
      label: 'Descriere (EN)',
      editable: true,
      aiEnabled: true,
      aiMode: 'translate',
      aiLabel: 'Traduce din RO (4 agenți consensus)',
      multiline: true,
    },
  ];

  const readonlyFields: { label: string; value: string | null | number }[] = [
    { label: 'Handle', value: collection.handle },
    { label: 'Tip colecție', value: collection.collection_type },
    { label: 'Produse', value: collection.products_count },
    { label: 'Shopify GID', value: collection.shopify_gid },
    { label: 'Legacy ID', value: collection.legacy_resource_id },
    { label: 'Taxonomie', value: collection.taxonomy_name },
    { label: 'Nivel meniu', value: collection.menu_level },
    { label: 'Path meniu', value: collection.menu_path },
    { label: 'Colecție părinte', value: collection.parent_title },
    {
      label: 'Sincronizat',
      value: collection.synced_at ? new Date(collection.synced_at).toLocaleString('ro-RO') : null,
    },
  ];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageActionBusy = generatingImage || approvingImage || uploadingImage;

  return (
    <div className="space-y-4">
      {collection.image_url ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <img
            src={collection.image_url}
            alt={collection.title}
            className="h-40 w-full object-cover"
          />
        </div>
      ) : collection.has_pending_image ? (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg border-2 border-dashed border-accent/60 bg-accent/5">
            <img
              src={`/api/collections/${collection.id}/pending-image?t=${Date.now()}`}
              alt="Imagine pending"
              className="h-40 w-full object-cover"
            />
          </div>
          <p className="text-center text-xs font-medium text-amber-600">
            Imagine în așteptare — necesită aprobare
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={imageActionBusy}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
              onClick={() => void onApproveImage()}
            >
              {approvingImage ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" /> Se trimite...
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5" /> Aprobă Imagine
                </>
              )}
            </button>
            <button
              type="button"
              disabled={imageActionBusy}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              onClick={() => void onGenerateImage()}
            >
              {generatingImage ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" /> Se regenerează...
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" /> Regenerează
                </>
              )}
            </button>
            <button
              type="button"
              disabled={imageActionBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadingImage ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" /> Se încarcă...
                </>
              ) : (
                <>
                  <Upload className="size-3.5" /> Încarcă alta
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-40 flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed border-amber-400 bg-amber-50">
          <div className="flex items-center gap-2 text-amber-600">
            <ImageIcon className="size-5" />
            <span className="text-sm font-semibold">Imagine Lipsă</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={imageActionBusy}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              onClick={() => void onGenerateImage()}
            >
              {generatingImage ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" /> Se generează...
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" /> Generează cu AI
                </>
              )}
            </button>
            <button
              type="button"
              disabled={imageActionBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadingImage ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" /> Se încarcă...
                </>
              ) : (
                <>
                  <Upload className="size-3.5" /> Încarcă imagine
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void onUploadImage(file);
            e.target.value = '';
          }
        }}
      />

      {editableFields.map((field) => {
        const isAiGenerating = aiGeneratingField === field.key;
        const value = getDraftFieldValue(collection, titleEn, draftFields, field.key);
        const isDirty = dirtyFields.includes(field.key);

        return (
          <div
            key={field.key}
            className={`rounded-lg border bg-card p-3 ${
              isDirty ? 'border-warning/50' : 'border-border'
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {field.label}
              </span>
              <div className="flex gap-1">
                {isDirty && <Badge tone="warning">Nesalvat</Badge>}
                {field.aiEnabled && (
                  <button
                    type="button"
                    disabled={isAiGenerating}
                    className={`rounded p-1 disabled:opacity-50 ${
                      field.aiMode === 'translate'
                        ? 'text-primary/60 hover:bg-primary/5 hover:text-primary'
                        : 'text-accent hover:bg-accent/5 hover:text-accent'
                    }`}
                    title={field.aiLabel ?? 'AI'}
                    onClick={() => void onAiGenerate(field.key)}
                  >
                    {isAiGenerating ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : field.aiMode === 'translate' ? (
                      <Languages className="size-3.5" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
            {field.multiline ? (
              <textarea
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-ring-standard"
                rows={4}
                value={value}
                onChange={(e) => onDraftFieldChange(field.key, e.target.value)}
              />
            ) : (
              <TextField
                value={value}
                onChange={(e) => onDraftFieldChange(field.key, e.target.value)}
              />
            )}
          </div>
        );
      })}

      {dirtyFields.length > 0 && (
        <div className="sticky bottom-0 z-10 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-warning">{dirtyFields.length} câmpuri modificate local.</p>
            <Button
              variant="secondary"
              onClick={() => void onSaveChanges()}
              disabled={savingDetails}
            >
              {savingDetails ? 'Se salvează...' : 'Salvează modificările'}
            </Button>
          </div>
        </div>
      )}

      {collection.menu_path && (
        <div className="rounded-lg border border-border bg-card p-3">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">
            Ierarhie categorii
          </span>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {parseMenuPath(collection.menu_path).map((segment, i, arr) => (
              <span key={`${segment}-${i}`} className="inline-flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 text-muted" />}
                <span className={i === arr.length - 1 ? 'font-medium text-primary' : 'text-muted'}>
                  {segment}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Informații suplimentare
          </span>
        </div>
        <div className="divide-y divide-border/40">
          {readonlyFields.map((rf) => (
            <div key={rf.label} className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted">{rf.label}</span>
              <span className="max-w-[60%] truncate text-right text-xs font-medium text-foreground">
                {rf.value ?? '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {collection.shopify_gid && (
        <a
          href={`https://admin.shopify.com/store/neanelu/collections/${collection.legacy_resource_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary"
        >
          <ExternalLink className="size-3.5" />
          Deschide în Shopify
        </a>
      )}
    </div>
  );
}

interface DrawerProps {
  collection: CollectionRow;
  api: ReturnType<typeof useApiClient>;
  onSelectCollection: (collection: CollectionRow) => void;
  onClose: () => void;
  onRefresh: () => void;
}

function CollectionDetailDrawerInline({
  collection,
  api,
  onSelectCollection,
  onClose,
  onRefresh,
}: DrawerProps) {
  const [activeTab, setActiveTab] = useState<
    'details' | 'products' | 'taxonomy' | 'metafields' | 'menuAi'
  >('details');
  const [products, setProducts] = useState<
    { id: string; title: string; products_count?: number; quality_level?: string }[]
  >([]);
  interface SchemaMetafield {
    attr_code: string;
    shopify_namespace: string;
    shopify_key: string;
    shopify_type: string;
    display_name: string | null;
    display_name_en: string | null;
    description: string | null;
    is_required: boolean;
    ai_generated: boolean;
  }
  interface MetafieldsData {
    metafields: Record<string, unknown>;
    schema: SchemaMetafield[];
  }
  const [metafieldsData, setMetafieldsData] = useState<MetafieldsData | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingMetafields, setLoadingMetafields] = useState(false);
  const [taxonomyName, setTaxonomyName] = useState<string | null>(collection.taxonomy_name);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [dissociating, setDissociating] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [approvingImage, setApprovingImage] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    setActiveTab('details');
    setProducts([]);
    setMetafieldsData(null);
    setTaxonomyName(collection.taxonomy_name);
    setSelectedProductIds(new Set());
  }, [collection.id, collection.taxonomy_name]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const result = await api.getApi<{ products: typeof products }>(
        `/collections/${collection.id}/products`
      );
      setProducts(result.products);
    } catch {
      toast.error('Eroare la încărcare produse');
    } finally {
      setLoadingProducts(false);
    }
  }, [api, collection.id]);

  const loadMetafields = useCallback(async () => {
    setLoadingMetafields(true);
    try {
      const result = await api.getApi<MetafieldsData>(`/collections/${collection.id}/metafields`);
      setMetafieldsData(result);
    } catch {
      toast.error('Eroare la încărcare metafields');
    } finally {
      setLoadingMetafields(false);
    }
  }, [api, collection.id]);

  const loadMenuAssignments = useCallback(async () => {
    setLoadingMenuAssignments(true);
    try {
      const result = await api.getApi<MenuAssignmentStatusResponse>(
        `/collections/${collection.id}/menu-assignment-status`
      );
      setMenuAssignments(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la încărcarea asignărilor AI');
    } finally {
      setLoadingMenuAssignments(false);
    }
  }, [api, collection.id]);

  const handleOpenParent = useCallback(async () => {
    if (!collection.parent_collection_id) return;
    try {
      const result = await api.getApi<{ collection: CollectionRow }>(
        `/collections/${collection.parent_collection_id}`
      );
      onSelectCollection(result.collection);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la încărcarea colecției părinte');
    }
  }, [api, collection.parent_collection_id, onSelectCollection]);

  useEffect(() => {
    if (activeTab === 'products') void loadProducts();
    if (activeTab === 'metafields') void loadMetafields();
    if (activeTab === 'menuAi') void loadMenuAssignments();
  }, [activeTab, loadProducts, loadMetafields, loadMenuAssignments]);

  interface ProgressStep {
    step: string;
    message: string;
    status: 'in_progress' | 'done' | 'error';
  }
  const [assignRunning, setAssignRunning] = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);

  const [titleEn, setTitleEn] = useState<string | null>(collection.title_en ?? null);
  const [translateRunningLocal, setTranslateRunningLocal] = useState(false);
  const [translateSteps, setTranslateSteps] = useState<ProgressStep[]>([]);
  const [menuAssignments, setMenuAssignments] = useState<MenuAssignmentStatusResponse | null>(null);
  const [loadingMenuAssignments, setLoadingMenuAssignments] = useState(false);
  const [menuAssignRunning, setMenuAssignRunning] = useState(false);
  const [menuAssignSteps, setMenuAssignSteps] = useState<ProgressStep[]>([]);
  const [menuActionBusyId, setMenuActionBusyId] = useState<string | null>(null);

  // ─── Metafield AI generation ─────────────────────────────────────
  interface MetafieldSuggestion {
    attr_code: string;
    display_name_ro: string;
    display_name_en: string;
    shopify_key: string;
    shopify_type: string;
    description: string;
    is_required: boolean;
  }
  const [metafieldGenerating, setMetafieldGenerating] = useState(false);
  const [metafieldSteps, setMetafieldSteps] = useState<ProgressStep[]>([]);
  const [metafieldSuggestions, setMetafieldSuggestions] = useState<MetafieldSuggestion[]>([]);
  const [selectedSuggestionCodes, setSelectedSuggestionCodes] = useState<Set<string>>(new Set());
  const [acceptingMetafields, setAcceptingMetafields] = useState(false);
  const [draftFields, setDraftFields] = useState<Record<string, string>>({
    title: collection.title ?? '',
    title_en: collection.title_en ?? '',
    description: collection.description ?? '',
    description_en: collection.description_en ?? '',
  });
  const [savingDetails, setSavingDetails] = useState(false);
  const [aiGeneratingField, setAiGeneratingField] = useState<string | null>(null);

  useEffect(() => {
    setTitleEn(collection.title_en ?? null);
    setTranslateSteps([]);
    setMenuAssignments(null);
    setMenuAssignSteps([]);
    setMenuActionBusyId(null);
    setMetafieldSuggestions([]);
    setMetafieldSteps([]);
    setSelectedSuggestionCodes(new Set());
    setDraftFields({
      title: collection.title ?? '',
      title_en: collection.title_en ?? '',
      description: collection.description ?? '',
      description_en: collection.description_en ?? '',
    });
  }, [
    collection.description,
    collection.description_en,
    collection.id,
    collection.title,
    collection.title_en,
  ]);

  const dirtyFields = useMemo(() => {
    const comparisons: [string, string | null][] = [
      ['title', collection.title ?? null],
      ['title_en', titleEn ?? collection.title_en ?? null],
      ['description', collection.description ?? null],
      ['description_en', collection.description_en ?? null],
    ];
    return comparisons
      .filter(([field, original]) => (draftFields[field] ?? '') !== (original ?? ''))
      .map(([field]) => field);
  }, [
    collection.description,
    collection.description_en,
    collection.title,
    collection.title_en,
    draftFields,
    titleEn,
  ]);

  const handleTranslateSingle = useCallback(async () => {
    setTranslateRunningLocal(true);
    setTranslateSteps([]);
    try {
      await api.streamPost(
        `/collections/${collection.id}/translate`,
        { force: !!titleEn, source: 'ai_translate' },
        (event) => {
          const type = event['type'] as string;

          if (type === 'progress') {
            const step = event['step'] as string;
            const message = event['message'] as string;
            const status: 'in_progress' | 'done' | 'error' =
              (event['status'] as string) === 'done'
                ? 'done'
                : (event['status'] as string) === 'error'
                  ? 'error'
                  : 'in_progress';
            setTranslateSteps((prev) => {
              const existing = prev.findIndex((s) => s.step === step);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { step, message, status };
                return updated;
              }
              return [...prev, { step, message, status }];
            });
          }

          if (type === 'result') {
            const resultStatus = event['status'] as string;
            const consensusMethod = (event['consensusMethod'] as ConsensusMethod | null) ?? null;
            const consensusScore =
              typeof event['consensusScore'] === 'number' ? event['consensusScore'] : null;
            if (resultStatus === 'translated') {
              const translated = event['titleEn'] as string;
              setTitleEn(translated);
              setDraftFields((prev) => ({
                ...prev,
                title_en: translated,
                description_en: asDisplayText(event['descriptionEn'], prev['description_en'] ?? ''),
              }));
              if (event['descriptionEn']) {
                onRefresh();
              }
              setTranslateSteps((prev) => [
                ...prev,
                { step: 'done', message: `Traducere finalizată: „${translated}"`, status: 'done' },
                ...(consensusScore != null
                  ? [
                      {
                        step: 'consensus_result',
                        message: `Consens: ${formatConsensusMethod(consensusMethod)} · scor ${formatConsensusScore(consensusScore)}`,
                        status: 'done' as const,
                      },
                    ]
                  : []),
              ]);
              onRefresh();
            } else if (resultStatus === 'already_translated') {
              setTitleEn(event['titleEn'] as string);
            } else {
              setTranslateSteps((prev) => [
                ...prev,
                {
                  step: 'fail',
                  message: (event['message'] as string) ?? 'Traducerea nu a reușit.',
                  status: 'error',
                },
              ]);
            }
          }

          if (type === 'error') {
            setTranslateSteps((prev) => [
              ...prev,
              {
                step: 'error',
                message: (event['message'] as string) ?? 'Eroare la traducere.',
                status: 'error',
              },
            ]);
          }
        }
      );
    } catch (err) {
      setTranslateSteps((prev) => [
        ...prev,
        {
          step: 'error',
          message: err instanceof Error ? err.message : 'Eroare la traducere.',
          status: 'error',
        },
      ]);
    } finally {
      setTranslateRunningLocal(false);
    }
  }, [api, collection.id, onRefresh, titleEn]);

  const handleAssignTaxonomyAi = useCallback(async () => {
    setAssignRunning(true);
    setProgressSteps([]);
    if (taxonomyName) {
      setTaxonomyName(null);
    }

    try {
      await api.streamPost(
        `/collections/${collection.id}/assign-taxonomy-ai`,
        { source: 'ai_taxonomy' },
        (event) => {
          const type = event['type'] as string;

          if (type === 'progress') {
            const step = event['step'] as string;
            const message = event['message'] as string;
            const rawStatus = event['status'] as string | undefined;
            const status: ProgressStep['status'] =
              rawStatus === 'done' ? 'done' : rawStatus === 'error' ? 'error' : 'in_progress';
            setProgressSteps((prev) => {
              const existing = prev.findIndex((s) => s.step === step);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { step, message, status };
                return updated;
              }
              return [...prev, { step, message, status }];
            });
          }

          if (type === 'result') {
            const resultStatus = event['status'] as string;
            const consensusMethod = (event['consensusMethod'] as ConsensusMethod | null) ?? null;
            const consensusScore =
              typeof event['consensusScore'] === 'number' ? event['consensusScore'] : null;
            if (resultStatus === 'assigned') {
              const name = event['taxonomyName'] as string;
              const pct = Math.round(((event['confidence'] as number) ?? 0) * 100);
              setTaxonomyName(name);
              setProgressSteps((prev) => [
                ...prev,
                {
                  step: 'done',
                  message: `Taxonomie atribuită: „${name}" — ${pct}% confidență`,
                  status: 'done',
                },
                ...(consensusScore != null
                  ? [
                      {
                        step: 'consensus_result',
                        message: `Consens: ${formatConsensusMethod(consensusMethod)} · scor ${formatConsensusScore(consensusScore)}`,
                        status: 'done' as const,
                      },
                    ]
                  : []),
              ]);
              onRefresh();
              toast.success('Taxonomia a fost adăugată în coada de sincronizare');
            } else {
              const msg = (event['message'] as string) ?? 'Confidență scăzută. Atribuiți manual.';
              setProgressSteps((prev) => [
                ...prev,
                { step: 'low_conf', message: msg, status: 'error' },
              ]);
            }
          }

          if (type === 'error') {
            const msg = (event['message'] as string) ?? 'Eroare la atribuirea taxonomiei.';
            setProgressSteps((prev) => [
              ...prev.map((s) =>
                s.status === 'in_progress' ? { ...s, status: 'error' as const } : s
              ),
              { step: 'error', message: msg, status: 'error' },
            ]);
          }
        }
      );
    } catch (err) {
      setProgressSteps((prev) => [
        ...prev.map((s) => (s.status === 'in_progress' ? { ...s, status: 'error' as const } : s)),
        {
          step: 'error',
          message: err instanceof Error ? err.message : 'Eroare la atribuirea taxonomiei.',
          status: 'error',
        },
      ]);
    } finally {
      setAssignRunning(false);
    }
  }, [api, collection.id, taxonomyName, onRefresh]);

  const handleGenerateMetafieldsAi = useCallback(async () => {
    setMetafieldGenerating(true);
    setMetafieldSteps([]);
    setMetafieldSuggestions([]);
    setSelectedSuggestionCodes(new Set());
    try {
      await api.streamPost(`/collections/${collection.id}/generate-metafields-ai`, {}, (event) => {
        const type = event['type'] as string;
        if (type === 'progress') {
          const step = event['step'] as string;
          const message = event['message'] as string;
          const rawStatus = event['status'] as string | undefined;
          const status: ProgressStep['status'] =
            rawStatus === 'done' ? 'done' : rawStatus === 'error' ? 'error' : 'in_progress';
          setMetafieldSteps((prev) => {
            const existing = prev.findIndex((s) => s.step === step);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = { step, message, status };
              return updated;
            }
            return [...prev, { step, message, status }];
          });
        }
        if (type === 'result') {
          const suggestions = event['suggestions'] as MetafieldSuggestion[] | undefined;
          if (suggestions?.length) {
            setMetafieldSuggestions(suggestions);
            const allCodes = new Set(suggestions.map((s) => s.attr_code));
            setSelectedSuggestionCodes(allCodes);
            toast.success(`${suggestions.length} metafield-uri generate cu succes`);
          }
        }
        if (type === 'error') {
          const msg = (event['message'] as string) ?? 'Eroare la generarea metafield-urilor.';
          setMetafieldSteps((prev) => [
            ...prev.map((s) =>
              s.status === 'in_progress' ? { ...s, status: 'error' as const } : s
            ),
            { step: 'error', message: msg, status: 'error' },
          ]);
          toast.error(msg);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Eroare la generarea metafield-urilor.';
      setMetafieldSteps((prev) => [
        ...prev.map((s) => (s.status === 'in_progress' ? { ...s, status: 'error' as const } : s)),
        { step: 'error', message: msg, status: 'error' },
      ]);
      toast.error(msg);
    } finally {
      setMetafieldGenerating(false);
    }
  }, [api, collection.id]);

  const handleAcceptMetafields = useCallback(async () => {
    const selected = metafieldSuggestions.filter((s) => selectedSuggestionCodes.has(s.attr_code));
    if (selected.length === 0) return;
    setAcceptingMetafields(true);
    try {
      await api.postApi(`/collections/${collection.id}/accept-metafields`, {
        metafields: selected,
      });
      toast.success(`${selected.length} metafield-uri trimise în coada HITL`);
      setMetafieldSuggestions([]);
      setSelectedSuggestionCodes(new Set());
      setMetafieldSteps([]);
      setMetafieldsData(null);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la acceptarea metafield-urilor.');
    } finally {
      setAcceptingMetafields(false);
    }
  }, [api, collection.id, metafieldSuggestions, selectedSuggestionCodes, onRefresh]);

  const handleAssignMenuAi = useCallback(async () => {
    setMenuAssignRunning(true);
    setMenuAssignSteps([]);
    try {
      await api.streamPost(`/collections/${collection.id}/assign-menu-ai`, {}, (event) => {
        const type = event['type'] as string;

        if (type === 'menu_assign_progress') {
          const step = event['step'] as string;
          const message = event['message'] as string;
          const status: 'in_progress' | 'done' | 'error' =
            (event['status'] as string) === 'done'
              ? 'done'
              : (event['status'] as string) === 'error'
                ? 'error'
                : 'in_progress';
          setMenuAssignSteps((prev) => {
            const existing = prev.findIndex((entry) => entry.step === step);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = { step, message, status };
              return updated;
            }
            return [...prev, { step, message, status }];
          });
        }

        if (type === 'menu_assign_collection_result') {
          const resultStatus = event['status'] as string;
          const resultMessage = (event['message'] as string) ?? 'Proces finalizat.';
          const consensusMethod = (event['consensusMethod'] as ConsensusMethod | null) ?? null;
          const consensusScore =
            typeof event['consensusScore'] === 'number' ? event['consensusScore'] : null;
          setMenuAssignSteps((prev) => [
            ...prev,
            {
              step: 'result',
              message: resultMessage,
              status: resultStatus === 'error' ? 'error' : 'done',
            },
            ...(consensusScore != null
              ? [
                  {
                    step: 'consensus_result',
                    message: `Consens: ${formatConsensusMethod(consensusMethod)} · scor ${formatConsensusScore(consensusScore)}`,
                    status: 'done' as const,
                  },
                ]
              : []),
          ]);
          void loadMenuAssignments();
          onRefresh();
        }

        if (type === 'error') {
          setMenuAssignSteps((prev) => [
            ...prev.map((s) =>
              s.status === 'in_progress' ? { ...s, status: 'error' as const } : s
            ),
            {
              step: 'error',
              message: (event['message'] as string) ?? 'Eroare la asignarea AI.',
              status: 'error',
            },
          ]);
        }
      });
    } catch (err) {
      setMenuAssignSteps((prev) => [
        ...prev.map((s) => (s.status === 'in_progress' ? { ...s, status: 'error' as const } : s)),
        {
          step: 'error',
          message: err instanceof Error ? err.message : 'Eroare la asignarea AI.',
          status: 'error',
        },
      ]);
    } finally {
      setMenuAssignRunning(false);
    }
  }, [api, collection.id, loadMenuAssignments, onRefresh]);

  const handleDissociateProducts = useCallback(async () => {
    if (selectedProductIds.size === 0) return;
    setDissociating(true);
    try {
      const result = await api.postApi<
        { removed: number; productTitles: string[] },
        { productIds: string[] }
      >(`/collections/${collection.id}/dissociate-products`, {
        productIds: [...selectedProductIds],
      });
      toast.success(`${result.removed} produs(e) dezasociat(e) — trimis în HITL.`);
      setSelectedProductIds(new Set());
      void loadProducts();
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la dezasociere.');
    } finally {
      setDissociating(false);
    }
  }, [api, collection.id, selectedProductIds, loadProducts, onRefresh]);

  const runMenuAssignmentAction = useCallback(
    async (assignmentId: string, action: 'approve' | 'reject' | 'primary' | 'delete') => {
      setMenuActionBusyId(assignmentId);
      try {
        if (action === 'approve') {
          await api.postApi(
            `/collections/${collection.id}/menu-assignments/${assignmentId}/approve`,
            {}
          );
          toast.success('Modificarea de meniu a fost adăugată în coada de sincronizare');
        } else if (action === 'reject') {
          await api.postApi(
            `/collections/${collection.id}/menu-assignments/${assignmentId}/reject`,
            {}
          );
        } else if (action === 'primary') {
          await api.patchApi(
            `/collections/${collection.id}/menu-assignments/${assignmentId}/primary`,
            {}
          );
        } else {
          await api.deleteApi(`/collections/${collection.id}/menu-assignments/${assignmentId}`);
          toast.success('Eliminarea din meniu a fost adăugată în coada de sincronizare');
        }
        await loadMenuAssignments();
        onRefresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Operația pe asignare a eșuat.');
      } finally {
        setMenuActionBusyId(null);
      }
    },
    [api, collection.id, loadMenuAssignments, onRefresh]
  );

  const handleSaveDetails = useCallback(async () => {
    if (dirtyFields.length === 0) return;
    setSavingDetails(true);
    try {
      const payload = Object.fromEntries(
        dirtyFields.map((field) => [field, (draftFields[field] ?? '').trim() || null])
      );
      const resp = await api.patchApi(`/collections/${collection.id}`, {
        ...payload,
        source: 'manual',
      });
      if ('title_en' in payload) {
        const nextTitleEn = payload['title_en'];
        if (typeof nextTitleEn === 'string' || nextTitleEn === null) {
          setTitleEn(nextTitleEn);
        }
      }
      const hasSyncableFields = 'title' in payload || 'description' in payload;
      const pendingCount = (resp as Record<string, unknown>)?.['pendingChanges'] as
        | Record<string, unknown>
        | undefined;
      if (hasSyncableFields && pendingCount) {
        toast.success('Modificările au fost salvate și adăugate în coada de sincronizare');
      } else {
        toast.success('Modificările au fost salvate local');
      }
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Eroare la salvarea modificărilor');
    } finally {
      setSavingDetails(false);
    }
  }, [api, collection.id, dirtyFields, draftFields, onRefresh]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-9998" onClick={onClose}>
      <div
        className="pointer-events-none absolute inset-0 bg-overlay/[0.10] motion-safe:animate-[fadeIn_150ms_ease-out]"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={collection.title}
        className="absolute inset-y-0 right-0 z-10 flex h-full w-130 flex-col overflow-hidden border-l border-border/30 shadow-(--shadow-xl) motion-safe:animate-[slideInRight_0.3s_ease-out]"
        style={{ backgroundColor: 'rgb(var(--color-card))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-border/60 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">{collection.title}</h2>
            <p className="mt-0.5 text-sm text-muted">
              {collection.collection_type} · {collection.products_count} produse
            </p>
            {collection.menu_path && (
              <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
                {parseMenuPath(collection.menu_path).map((segment, i, arr) => (
                  <span key={`${segment}-${i}`} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronRight className="size-3" />}
                    <span className={i === arr.length - 1 ? 'font-medium text-muted' : undefined}>
                      {segment}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {collection.parent_title && collection.parent_collection_id && (
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary"
                onClick={() => void handleOpenParent()}
              >
                <ChevronRight className="size-3" />
                Deschide părintele: {collection.parent_title}
              </button>
            )}
            {collection.description && (
              <div className="mt-3 rounded-md bg-subtle p-3">
                <p className="text-xs leading-relaxed text-muted">
                  {collection.description.slice(0, 200)}
                  {collection.description.length > 200 ? '...' : ''}
                </p>
                {collection.description_en && (
                  <p className="mt-1.5 text-xs italic leading-relaxed text-muted">
                    {collection.description_en.slice(0, 200)}
                    {collection.description_en.length > 200 ? '...' : ''}
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className="ml-3 inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-muted transition-colors hover:bg-subtle/60 hover:text-foreground focus-ring-standard"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex shrink-0 border-b border-border/60"
          style={{ backgroundColor: 'rgb(var(--color-subtle))' }}
        >
          {(['details', 'products', 'taxonomy', 'menuAi', 'metafields'] as const).map((tab) => {
            const label =
              tab === 'details'
                ? 'Detalii'
                : tab === 'products'
                  ? 'Produse'
                  : tab === 'taxonomy'
                    ? 'Taxonomie'
                    : tab === 'menuAi'
                      ? 'Categorii AI'
                      : 'Metafields';
            const isActive = activeTab === tab;
            return (
              <button
                type="button"
                key={tab}
                className={`relative flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
                  isActive ? 'text-primary' : 'text-muted hover:text-foreground'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {label}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div
          className="min-h-0 flex-1 overflow-y-auto p-5"
          style={{ backgroundColor: 'rgb(var(--color-background))' }}
        >
          {activeTab === 'details' && (
            <DetailsTab
              collection={collection}
              titleEn={titleEn}
              draftFields={draftFields}
              dirtyFields={dirtyFields}
              savingDetails={savingDetails}
              aiGeneratingField={aiGeneratingField}
              generatingImage={generatingImage}
              approvingImage={approvingImage}
              uploadingImage={uploadingImage}
              onDraftFieldChange={(field, value) =>
                setDraftFields((prev) => ({
                  ...prev,
                  [field]: value,
                }))
              }
              onGenerateImage={async () => {
                setGeneratingImage(true);
                try {
                  await api.postApi(`/collections/${collection.id}/generate-image`, {});
                  toast.success('Imagine generată! Verifică și aprobă.');
                  onRefresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Eroare la generarea imaginii');
                } finally {
                  setGeneratingImage(false);
                }
              }}
              onUploadImage={async (file: File) => {
                setUploadingImage(true);
                try {
                  const formData = new FormData();
                  formData.append('file', file);
                  await api.postApi(`/collections/${collection.id}/upload-image`, formData);
                  toast.success('Imagine încărcată! Verifică și aprobă.');
                  onRefresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Eroare la încărcarea imaginii');
                } finally {
                  setUploadingImage(false);
                }
              }}
              onApproveImage={async () => {
                setApprovingImage(true);
                try {
                  await api.postApi(`/collections/${collection.id}/approve-image`, {});
                  toast.success('Imagine aprobată și trimisă la Shopify!');
                  onRefresh();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Eroare la aprobarea imaginii');
                } finally {
                  setApprovingImage(false);
                }
              }}
              onAiGenerate={async (field) => {
                setAiGeneratingField(field);
                try {
                  if (field === 'title' || field === 'description') {
                    await api.streamPost(
                      `/collections/${collection.id}/generate-ro`,
                      { field, source: 'ai_generate' },
                      (event) => {
                        const type = event['type'] as string;
                        if (type === 'result' && event['status'] === 'generated') {
                          onRefresh();
                        }
                      }
                    );
                    onRefresh();
                    toast.success(
                      field === 'title'
                        ? 'Titlu RO generat cu consensus 4 agenți'
                        : 'Descriere RO generată cu consensus 4 agenți'
                    );
                  } else {
                    await api.streamPost(
                      `/collections/${collection.id}/translate`,
                      { force: true, source: 'ai_translate', field },
                      (event) => {
                        const type = event['type'] as string;
                        if (type === 'result' && event['status'] === 'translated') {
                          if (field === 'title_en' && event['titleEn']) {
                            const translated = event['titleEn'] as string;
                            setTitleEn(translated);
                            setDraftFields((prev) => ({ ...prev, title_en: translated }));
                          }
                          if (field === 'description_en' && event['descriptionEn']) {
                            const translated = asDisplayText(event['descriptionEn'], '');
                            setDraftFields((prev) => ({ ...prev, description_en: translated }));
                          }
                        }
                      }
                    );
                    onRefresh();
                    toast.success(
                      field === 'title_en'
                        ? 'Titlu tradus cu consensus 4 agenți'
                        : 'Descriere tradusă cu consensus 4 agenți'
                    );
                  }
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Eroare la generare AI');
                } finally {
                  setAiGeneratingField(null);
                }
              }}
              onSaveChanges={handleSaveDetails}
            />
          )}

          {activeTab === 'products' && (
            <div className="relative">
              {loadingProducts ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded bg-subtle" />
                  ))}
                </div>
              ) : products.length === 0 ? (
                <EmptyState
                  title="Niciun produs"
                  description="Niciun produs în această colecție."
                />
              ) : (
                <>
                  {products.length > 1 && (
                    <div className="flex items-center gap-2 border-b border-border/40 pb-2 mb-1">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                        checked={selectedProductIds.size === products.length}
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              selectedProductIds.size > 0 &&
                              selectedProductIds.size < products.length;
                        }}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedProductIds(new Set(products.map((p) => p.id)));
                          } else {
                            setSelectedProductIds(new Set());
                          }
                        }}
                      />
                      <span className="text-xs text-muted">
                        {selectedProductIds.size > 0
                          ? `${selectedProductIds.size} din ${products.length} selectat(e)`
                          : `Selectează toate (${products.length})`}
                      </span>
                    </div>
                  )}
                  <ul className="divide-y divide-border/40">
                    {products.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border-gray-300 accent-blue-600"
                          checked={selectedProductIds.has(p.id)}
                          onChange={(e) => {
                            setSelectedProductIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) {
                                next.add(p.id);
                              } else {
                                next.delete(p.id);
                              }
                              return next;
                            });
                          }}
                        />
                        <span className="flex-1 text-foreground truncate">{p.title}</span>
                        {p.quality_level && <Badge tone="neutral">{p.quality_level}</Badge>}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {selectedProductIds.size > 0 && (
                <div className="sticky bottom-0 z-10 -mx-6 border-t border-border bg-white px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">
                      {selectedProductIds.size} produs(e) selectat(e)
                    </span>
                    <button
                      type="button"
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      disabled={dissociating}
                      onClick={() => void handleDissociateProducts()}
                    >
                      {dissociating ? 'Se dezasociază...' : 'Dezasociere'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'taxonomy' && (
            <div className="space-y-4">
              {/* Traducere EN */}
              <div className="rounded-lg border border-border p-4">
                <h3 className="mb-2 text-sm font-medium text-foreground">Traducere EN</h3>
                {titleEn ? (
                  <p className="text-sm font-medium text-success">„{titleEn}"</p>
                ) : translateRunningLocal ? (
                  <p className="text-sm text-warning">Se traduce...</p>
                ) : (
                  <p className="text-sm text-muted">Netradusă</p>
                )}
                {translateSteps.length > 0 && (
                  <div className="mt-3 rounded border border-border bg-subtle p-3">
                    <ul className="space-y-1.5">
                      {translateSteps.map((s, i) => (
                        <li key={`${s.step}-${i}`} className="flex items-start gap-2 text-xs">
                          <span className="mt-0.5 shrink-0">
                            {s.status === 'in_progress' && (
                              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            )}
                            {s.status === 'done' && (
                              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-[9px] text-success-foreground">
                                &#10003;
                              </span>
                            )}
                            {s.status === 'error' && (
                              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-error/50 text-[9px] text-error-foreground">
                                &#10007;
                              </span>
                            )}
                          </span>
                          <span
                            className={
                              s.status === 'error'
                                ? 'text-error'
                                : s.status === 'done'
                                  ? 'text-success'
                                  : 'text-foreground'
                            }
                          >
                            {s.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    onClick={() => void handleTranslateSingle()}
                    disabled={translateRunningLocal || assignRunning || menuAssignRunning}
                  >
                    <Languages
                      className={`mr-1.5 size-3.5 ${translateRunningLocal ? 'animate-pulse' : ''}`}
                    />
                    {translateRunningLocal
                      ? 'Se traduce...'
                      : titleEn
                        ? 'Retraduce cu AI'
                        : 'Traduce cu AI'}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="mb-2 text-sm font-medium text-foreground">Taxonomie atribuită</h3>
                {taxonomyName ? (
                  <p className="text-sm font-medium text-success">{taxonomyName}</p>
                ) : assignRunning ? (
                  <p className="text-sm text-warning">Se procesează...</p>
                ) : (
                  <p className="text-sm text-muted">Nicio taxonomie atribuită</p>
                )}
              </div>

              {progressSteps.length > 0 && (
                <div className="rounded-lg border border-border bg-subtle p-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    Progres operații
                  </h4>
                  <ul className="space-y-2">
                    {progressSteps.map((s, i) => (
                      <li key={`${s.step}-${i}`} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 shrink-0">
                          {s.status === 'in_progress' && (
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          )}
                          {s.status === 'done' && (
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-success text-[10px] text-success-foreground">
                              &#10003;
                            </span>
                          )}
                          {s.status === 'error' && (
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-error/50 text-[10px] text-error-foreground">
                              &#10007;
                            </span>
                          )}
                        </span>
                        <span
                          className={
                            s.status === 'error'
                              ? 'text-error'
                              : s.status === 'done'
                                ? 'text-success'
                                : 'text-foreground'
                          }
                        >
                          {s.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void handleAssignTaxonomyAi()}
                  disabled={assignRunning || menuAssignRunning}
                >
                  {assignRunning
                    ? 'Se procesează...'
                    : taxonomyName
                      ? 'Reatribuie cu AI'
                      : 'Atribuie cu AI'}
                </Button>
              </div>
            </div>
          )}

          {/* ─── Secțiunea Metafield-uri standardizate ─── */}
          {activeTab === 'taxonomy' && (
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Metafield-uri standardizate
                  </h3>
                  <p className="mt-0.5 text-xs text-muted">
                    Atribute tehnice standardizate moștenite de produsele din această colecție.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void handleGenerateMetafieldsAi()}
                  disabled={metafieldGenerating || acceptingMetafields || !titleEn || !taxonomyName}
                  title={
                    !titleEn
                      ? 'Necesită traducere EN'
                      : !taxonomyName
                        ? 'Necesită taxonomie atribuită'
                        : 'Generează metafield-uri tehnice cu AI'
                  }
                >
                  {metafieldGenerating ? (
                    <>
                      <span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      Se generează...
                    </>
                  ) : (
                    'Generează Metafields AI'
                  )}
                </Button>
              </div>

              {/* Progress steps */}
              {metafieldSteps.length > 0 && (
                <div className="mb-4 rounded border border-border bg-subtle p-3">
                  <ul className="space-y-1.5">
                    {metafieldSteps.map((s, i) => (
                      <li key={`${s.step}-${i}`} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 shrink-0">
                          {s.status === 'in_progress' && (
                            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          )}
                          {s.status === 'done' && (
                            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-[9px] text-success-foreground">
                              &#10003;
                            </span>
                          )}
                          {s.status === 'error' && (
                            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-error/50 text-[9px] text-error-foreground">
                              &#10007;
                            </span>
                          )}
                        </span>
                        <span
                          className={
                            s.status === 'error'
                              ? 'text-error'
                              : s.status === 'done'
                                ? 'text-success'
                                : 'text-foreground'
                          }
                        >
                          {s.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Sugestii generate */}
              {metafieldSuggestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted mb-2">
                    Selectează metafield-urile pe care vrei să le accepți și trimite-le în coada
                    HITL:
                  </p>
                  {metafieldSuggestions.map((suggestion) => (
                    <label
                      key={suggestion.attr_code}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 hover:bg-subtle"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
                        checked={selectedSuggestionCodes.has(suggestion.attr_code)}
                        onChange={(e) => {
                          setSelectedSuggestionCodes((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) {
                              next.add(suggestion.attr_code);
                            } else {
                              next.delete(suggestion.attr_code);
                            }
                            return next;
                          });
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground">
                            {suggestion.display_name_ro}
                          </span>
                          <span className="text-xs text-muted">/ {suggestion.display_name_en}</span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                            {suggestion.shopify_type}
                          </span>
                        </div>
                        {suggestion.description && (
                          <p className="mt-0.5 text-xs text-muted">{suggestion.description}</p>
                        )}
                        <p className="mt-0.5 font-mono text-[10px] text-muted">
                          custom.{suggestion.shopify_key}
                        </p>
                      </div>
                    </label>
                  ))}

                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="primary"
                      onClick={() => void handleAcceptMetafields()}
                      disabled={acceptingMetafields || selectedSuggestionCodes.size === 0}
                    >
                      {acceptingMetafields
                        ? 'Se trimite...'
                        : `Acceptă Selectate (${selectedSuggestionCodes.size})`}
                    </Button>
                    <button
                      type="button"
                      className="text-xs text-muted underline hover:text-foreground"
                      onClick={() => {
                        setSelectedSuggestionCodes(
                          new Set(metafieldSuggestions.map((s) => s.attr_code))
                        );
                      }}
                    >
                      Selectează tot
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted underline hover:text-foreground"
                      onClick={() => setSelectedSuggestionCodes(new Set())}
                    >
                      Deselectează tot
                    </button>
                  </div>
                </div>
              )}

              {/* Pre-condiții lipsă */}
              {!metafieldGenerating &&
                metafieldSuggestions.length === 0 &&
                metafieldSteps.length === 0 && (
                  <p className="text-xs text-muted">
                    {!titleEn && !taxonomyName
                      ? 'Necesită traducere EN și taxonomie atribuită pentru generare AI.'
                      : !titleEn
                        ? 'Necesită traducere EN pentru generare AI.'
                        : !taxonomyName
                          ? 'Necesită taxonomie atribuită pentru generare AI.'
                          : 'Apasă "Generează Metafields AI" pentru a genera sugestii de atribute tehnice.'}
                  </p>
                )}
            </div>
          )}

          {activeTab === 'menuAi' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">
                      Asignare categorii/meniu AI
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      AI propune poziții existente în arborele Shopify și semnalează path-uri noi
                      doar pentru review uman.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => void handleAssignMenuAi()}
                    disabled={menuAssignRunning || loadingMenuAssignments}
                  >
                    {menuAssignRunning
                      ? 'Se procesează...'
                      : (menuAssignments?.activeAssignments.length ?? 0) > 0 ||
                          (menuAssignments?.proposedAssignments.length ?? 0) > 0
                        ? 'Reasignează cu AI'
                        : 'Asignează cu AI pe categorii'}
                  </Button>
                </div>
              </div>

              {menuAssignSteps.length > 0 && (
                <div className="rounded-lg border border-border bg-subtle p-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    Progres asignare AI
                  </h4>
                  <ul className="space-y-2">
                    {menuAssignSteps.map((step, index) => (
                      <li key={`${step.step}-${index}`} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 shrink-0">
                          {step.status === 'in_progress' && (
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          )}
                          {step.status === 'done' && (
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-success text-[10px] text-success-foreground">
                              &#10003;
                            </span>
                          )}
                          {step.status === 'error' && (
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-error/50 text-[10px] text-error-foreground">
                              &#10007;
                            </span>
                          )}
                        </span>
                        <span
                          className={
                            step.status === 'error'
                              ? 'text-error'
                              : step.status === 'done'
                                ? 'text-success'
                                : 'text-foreground'
                          }
                        >
                          {step.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border border-border p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">Asocieri active</h3>
                {loadingMenuAssignments ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-16 animate-pulse rounded bg-subtle" />
                    ))}
                  </div>
                ) : (menuAssignments?.activeAssignments.length ?? 0) === 0 ? (
                  <EmptyState title="Nu există asocieri" description="Nu există asocieri active." />
                ) : (
                  <div className="space-y-3">
                    {menuAssignments?.activeAssignments.map((assignment) => (
                      <div key={assignment.id} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {parseMenuPath(assignment.menuItemPath).map((segment, index) => (
                                <span
                                  key={`${segment}-${index}`}
                                  className="inline-flex items-center rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted"
                                >
                                  {segment}
                                </span>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                              <Badge tone={assignment.isPrimary ? 'info' : 'neutral'}>
                                {assignment.isPrimary ? 'Primary' : 'Secondary'}
                              </Badge>
                              <span>Confidență: {formatConfidence(assignment.confidence)}</span>
                              <span>Sursă: {assignment.assignmentSource}</span>
                            </div>
                            {assignment.reasoning && (
                              <p className="text-xs text-muted">{assignment.reasoning}</p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!assignment.isPrimary && (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  void runMenuAssignmentAction(assignment.id, 'primary')
                                }
                                disabled={menuActionBusyId === assignment.id}
                              >
                                Setează ca primară
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              onClick={() => void runMenuAssignmentAction(assignment.id, 'delete')}
                              disabled={menuActionBusyId === assignment.id}
                            >
                              Șterge
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">Propuneri AI</h3>
                {(menuAssignments?.proposedAssignments.filter(
                  (assignment) => !assignment.proposedPath
                ).length ?? 0) === 0 ? (
                  <EmptyState
                    title="Nu există propuneri AI"
                    description="Nu există propuneri AI pentru review."
                  />
                ) : (
                  <div className="space-y-3">
                    {menuAssignments?.proposedAssignments
                      .filter((assignment) => !assignment.proposedPath)
                      .map((assignment) => (
                        <div
                          key={assignment.id}
                          className="rounded-lg border border-warning/30 bg-warning/5/70 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {parseMenuPath(assignment.menuItemPath).map((segment, index) => (
                                  <span
                                    key={`${segment}-${index}`}
                                    className="inline-flex items-center rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-warning"
                                  >
                                    {segment}
                                  </span>
                                ))}
                              </div>
                              <div className="text-xs text-warning">
                                Confidență: {formatConfidence(assignment.confidence)}
                              </div>
                              {assignment.reasoning && (
                                <p className="text-xs text-warning">{assignment.reasoning}</p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  void runMenuAssignmentAction(assignment.id, 'approve')
                                }
                                disabled={menuActionBusyId === assignment.id}
                              >
                                Aprobă
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  void runMenuAssignmentAction(assignment.id, 'reject')
                                }
                                disabled={menuActionBusyId === assignment.id}
                              >
                                Respinge
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">Propuneri path nou</h3>
                {(menuAssignments?.proposedAssignments.filter(
                  (assignment) => assignment.proposedPath
                ).length ?? 0) === 0 ? (
                  <EmptyState
                    title="Nu există path-uri noi"
                    description="Nu există path-uri noi propuse."
                  />
                ) : (
                  <div className="space-y-3">
                    {menuAssignments?.proposedAssignments
                      .filter((assignment) => assignment.proposedPath)
                      .map((assignment) => (
                        <div
                          key={assignment.id}
                          className="rounded-lg border border-warning/30 bg-warning/5/70 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {parseMenuPath(assignment.proposedPath).map((segment, index) => (
                                  <span
                                    key={`${segment}-${index}`}
                                    className="inline-flex items-center rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-warning"
                                  >
                                    {segment}
                                  </span>
                                ))}
                              </div>
                              <div className="text-xs text-warning">
                                Confidență: {formatConfidence(assignment.confidence)}
                              </div>
                              {assignment.reasoning && (
                                <p className="text-xs text-warning">{assignment.reasoning}</p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  void runMenuAssignmentAction(assignment.id, 'approve')
                                }
                                disabled={menuActionBusyId === assignment.id}
                              >
                                Aprobă
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  void runMenuAssignmentAction(assignment.id, 'reject')
                                }
                                disabled={menuActionBusyId === assignment.id}
                              >
                                Respinge
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'metafields' && (
            <div className="space-y-6">
              {loadingMetafields ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-8 animate-pulse rounded bg-subtle" />
                  ))}
                </div>
              ) : metafieldsData ? (
                <>
                  {/* Schema de atribute (din pim_taxonomy_metafield_schema) */}
                  {metafieldsData.schema.length > 0 ? (
                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-primary">
                        Schema atribute produs ({metafieldsData.schema.length})
                      </h4>
                      <div className="overflow-hidden rounded-lg border border-default">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-default bg-subtle">
                              <th className="px-3 py-2 text-left font-medium text-secondary">
                                Cod atribut
                              </th>
                              <th className="px-3 py-2 text-left font-medium text-secondary">
                                Nume RO
                              </th>
                              <th className="px-3 py-2 text-left font-medium text-secondary">
                                Tip Shopify
                              </th>
                              <th className="px-3 py-2 text-left font-medium text-secondary">
                                Namespace.Key
                              </th>
                              <th className="px-3 py-2 text-center font-medium text-secondary">
                                AI
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-default">
                            {metafieldsData.schema.map((s) => (
                              <tr key={s.attr_code} className="hover:bg-hover">
                                <td className="px-3 py-2 font-mono text-xs text-primary">
                                  {s.attr_code}
                                </td>
                                <td className="px-3 py-2 text-primary">
                                  {s.display_name ?? '—'}
                                  {s.description && (
                                    <span
                                      className="ml-1 text-xs text-tertiary"
                                      title={s.description}
                                    >
                                      ⓘ
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <span className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                    {s.shopify_type}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-mono text-xs text-secondary">
                                  {s.shopify_namespace}.{s.shopify_key}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {s.ai_generated ? (
                                    <span
                                      className="text-purple-600 dark:text-purple-400"
                                      title="Generat cu AI"
                                    >
                                      ✦
                                    </span>
                                  ) : (
                                    <span className="text-tertiary">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-default bg-subtle p-4 text-center text-sm text-secondary">
                      Nu există atribute definite în schema taxonomiei.
                      <br />
                      <span className="text-xs text-tertiary">
                        Folosește tab-ul &quot;Taxonomie atribuită&quot; → &quot;Generează
                        Metafields AI&quot; pentru a crea schema.
                      </span>
                    </div>
                  )}

                  {/* Metafields brute Shopify (raw) */}
                  {Object.keys(metafieldsData.metafields).length > 0 && (
                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-primary">
                        Metafields brute Shopify
                      </h4>
                      <pre className="max-h-64 overflow-auto rounded-lg bg-subtle p-4 text-xs">
                        {JSON.stringify(metafieldsData.metafields, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              ) : (
                <EmptyState
                  title="Nu există metafields"
                  description="Nu există metafields pentru această colecție."
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
