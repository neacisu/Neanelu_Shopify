import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ScanStatus = 'pending' | 'in_progress' | 'analyzed' | 'skipped' | 'failed';

interface InventoryIssue {
  source?: string;
  engine?: string;
  owner?: string;
  category?: string;
  type?: string;
  ruleId?: string;
  code?: string;
  severity?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  evidence?: string;
  message: string;
}

interface FileFingerprint {
  sizeBytes: number;
  modifiedAt: string;
}

interface InventoryLease {
  workerId: string;
  token: string;
  claimedAt: string;
  expiresAt: string;
}

interface InventoryEvent {
  at: string;
  action:
    | 'discovered'
    | 'claimed'
    | 'released'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'refreshed'
    | 'invalidated'
    | 'lease_expired'
    | 'recorded';
  workerId?: string;
  token?: string;
  issues?: number;
  detail?: string;
}

interface InventoryEntry {
  id: string;
  path: string;
  root: string;
  extension: string;
  status: ScanStatus;
  attempts: number;
  fingerprint: FileFingerprint;
  lease: InventoryLease | null;
  scannedAt: string | null;
  updatedAt: string;
  issues: InventoryIssue[];
  error: string | null;
  history: InventoryEvent[];
}

interface InventoryTotals {
  discovered: number;
  pending: number;
  in_progress: number;
  analyzed: number;
  skipped: number;
  failed: number;
  issues: number;
}

interface InventoryConfig {
  includeExtensions: string[];
  includeRoots: string[];
  includeFiles: string[];
  excludedSegments: string[];
  leaseSecondsDefault: number;
}

interface InventoryData {
  version: number;
  generatedAt: string;
  updatedAt: string;
  workspaceRoot: string;
  localAnalyzerFingerprint: string | null;
  config: InventoryConfig;
  totals: InventoryTotals;
  files: InventoryEntry[];
}

interface ClaimResult {
  ok: true;
  file: string | null;
  workerId: string;
  token: string | null;
  remainingPending: number;
}

interface ImportedFinding {
  path: string;
  issue: InventoryIssue;
}

interface ExportedFindings {
  version: 1;
  exportedAt: string;
  sourceInventory: string;
  totals: InventoryTotals;
  files: {
    path: string;
    status: ScanStatus;
    scannedAt: string | null;
    issues: InventoryIssue[];
    error: string | null;
  }[];
}

interface CliOptions {
  output: string;
  exportPath: string;
  leaseSeconds: number;
  lockTimeoutMs: number;
  worker: string;
  analyzerFingerprint?: string;
  inputPath?: string;
  inputFormat?: 'normalized' | 'vscode-diagnostics' | 'sarif' | 'sonar-external-issues';
  importSource?: string;
  file?: string;
  token?: string;
  error?: string;
  detail?: string;
  issuesFile?: string;
  issuesJson?: string;
}

const workspaceRoot = process.cwd();
const defaultOutput = path.join(workspaceRoot, 'temp', 'sonar-manual-inventory.json');
const defaultExport = path.join(workspaceRoot, 'temp', 'sonar-manual-findings.json');
const localFindingSources = new Set([
  'inventory',
  'typescript',
  'eslint',
  'json',
  'yaml',
  'markdownlint',
  'secret-scan',
]);
const includeExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.sql',
  '.py',
  '.sh',
  '.yaml',
  '.yml',
]);
const includeRoots = ['.'];
const includeFiles: string[] = [];
const excludedSegments = new Set([
  '.git',
  '.vscode',
  '.idea',
  '.pnpm-store',
  '.next',
  '.turbo',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.react-router',
  '.scannerwork',
  'temp',
  'temp-token',
  'secrets',
  'backups',
  'playwright-report',
  'test-results',
  'Research Produse',
  'Research Categorii',
  'Research Metafileds',
  'Arhiva_Research',
]);

await main();

async function main(): Promise<void> {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = parseOptions(args);

    switch (command) {
      case 'init':
        await initInventory(options.output, options.leaseSeconds);
        break;
      case 'refresh':
        await refreshInventory(options.output, options.leaseSeconds);
        break;
      case 'claim':
        await claimNext(options);
        break;
      case 'release':
        await releaseClaim(options);
        break;
      case 'complete':
        await finalizeFile(options, 'analyzed');
        break;
      case 'skip':
        await finalizeFile(options, 'skipped');
        break;
      case 'fail':
        await finalizeFile(options, 'failed');
        break;
      case 'retry-stale':
        await retryStaleClaims(options.output);
        break;
      case 'invalidate-local':
        await invalidateLocalFindings(options);
        break;
      case 'summary':
        await printSummary(options.output);
        break;
      case 'record-findings':
        await recordFindings(options);
        break;
      case 'export':
        await exportFindings(options.output, options.exportPath);
        break;
      case 'import-findings':
        await importFindings(options);
        break;
      case 'doctor':
        await runDoctor(options.output);
        break;
      default:
        printUsage();
        process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    output: defaultOutput,
    exportPath: defaultExport,
    leaseSeconds: 300,
    lockTimeoutMs: 15000,
    worker: 'manual-operator',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    switch (arg) {
      case '--':
        break;
      case '--output':
        options.output = resolveWithinWorkspace(value, '--output');
        index += 1;
        break;
      case '--export':
        options.exportPath = resolveWithinWorkspace(value, '--export');
        index += 1;
        break;
      case '--lease-seconds':
        options.leaseSeconds = parseIntegerOption(value, '--lease-seconds');
        index += 1;
        break;
      case '--lock-timeout-ms':
        options.lockTimeoutMs = parseIntegerOption(value, '--lock-timeout-ms');
        index += 1;
        break;
      case '--worker':
        options.worker = parseRequiredString(value, '--worker');
        index += 1;
        break;
      case '--analyzer-fingerprint':
        options.analyzerFingerprint = parseRequiredString(value, '--analyzer-fingerprint');
        index += 1;
        break;
      case '--input':
        options.inputPath = resolveWithinWorkspace(value, '--input');
        index += 1;
        break;
      case '--format':
        options.inputFormat = parseImportFormat(value);
        index += 1;
        break;
      case '--source':
        options.importSource = parseRequiredString(value, '--source');
        index += 1;
        break;
      case '--file':
        options.file = normalizePath(parseRequiredString(value, '--file'));
        index += 1;
        break;
      case '--token':
        options.token = parseRequiredString(value, '--token');
        index += 1;
        break;
      case '--error':
        options.error = parseRequiredString(value, '--error');
        index += 1;
        break;
      case '--detail':
        options.detail = parseRequiredString(value, '--detail');
        index += 1;
        break;
      case '--issues-file':
        options.issuesFile = resolveWithinWorkspace(value, '--issues-file');
        index += 1;
        break;
      case '--issues-json':
        options.issuesJson = parseRequiredString(value, '--issues-json');
        index += 1;
        break;
      default:
        throw new TypeError(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage(): void {
  process.stdout.write(`Usage:
  node --import tsx scripts/sonar/manual-inventory-worker.ts init
  node --import tsx scripts/sonar/manual-inventory-worker.ts refresh
  node --import tsx scripts/sonar/manual-inventory-worker.ts claim --worker worker-1 [--lease-seconds 300]
  node --import tsx scripts/sonar/manual-inventory-worker.ts release --file apps/example.ts --worker worker-1 --token lease-token
  node --import tsx scripts/sonar/manual-inventory-worker.ts complete --file apps/example.ts --worker worker-1 --token lease-token --issues-file temp/issues.json
  node --import tsx scripts/sonar/manual-inventory-worker.ts fail --file apps/example.ts --worker worker-1 --token lease-token --error "analysis failed"
  node --import tsx scripts/sonar/manual-inventory-worker.ts skip --file apps/example.ts --worker worker-1 --token lease-token --detail "unsupported"
  node --import tsx scripts/sonar/manual-inventory-worker.ts retry-stale
  node --import tsx scripts/sonar/manual-inventory-worker.ts invalidate-local --worker worker-1 --analyzer-fingerprint <fingerprint>
  node --import tsx scripts/sonar/manual-inventory-worker.ts summary
  node --import tsx scripts/sonar/manual-inventory-worker.ts record-findings --file apps/example.ts --issues-file temp/issues.json
  node --import tsx scripts/sonar/manual-inventory-worker.ts import-findings --input temp/findings.sarif --format sarif --source sonar
  node --import tsx scripts/sonar/manual-inventory-worker.ts export [--export temp/sonar-manual-findings.json]
  node --import tsx scripts/sonar/manual-inventory-worker.ts doctor\n`);
}

async function initInventory(outputPath: string, leaseSeconds: number): Promise<void> {
  const files = await discoverFiles();
  const now = timestamp();
  const inventory: InventoryData = {
    version: 3,
    generatedAt: now,
    updatedAt: now,
    workspaceRoot,
    localAnalyzerFingerprint: null,
    config: {
      includeExtensions: [...includeExtensions],
      includeRoots,
      includeFiles,
      excludedSegments: [...excludedSegments],
      leaseSecondsDefault: leaseSeconds,
    },
    totals: emptyTotals(),
    files,
  };

  inventory.totals = summarize(inventory.files);
  await persistInventory(outputPath, inventory);
  printJson({ ok: true, output: relativeToWorkspace(outputPath), totals: inventory.totals });
}

async function refreshInventory(outputPath: string, leaseSeconds: number): Promise<void> {
  const existing = await loadInventory(outputPath);
  const discovered = await discoverFiles();
  const existingByPath = new Map(existing.files.map((file) => [file.path, file]));
  const now = timestamp();

  const mergedFiles = discovered.map((candidate) => {
    const current = existingByPath.get(candidate.path);

    if (current == null) {
      candidate.history.push({ at: now, action: 'discovered', detail: 'Added during refresh' });
      return candidate;
    }

    const changed = hasFingerprintChanged(current.fingerprint, candidate.fingerprint);
    const resetStatus =
      changed &&
      (current.status === 'analyzed' ||
        current.status === 'failed' ||
        current.status === 'skipped');

    return {
      ...current,
      root: candidate.root,
      extension: candidate.extension,
      fingerprint: candidate.fingerprint,
      status: resetStatus ? 'pending' : current.status,
      updatedAt: now,
      lease: resetStatus ? null : current.lease,
      issues: resetStatus ? [] : current.issues,
      error: resetStatus ? null : current.error,
      scannedAt: resetStatus ? null : current.scannedAt,
      history: appendEvent(
        current.history,
        resetStatus
          ? { at: now, action: 'refreshed', detail: 'File changed; status reset to pending' }
          : { at: now, action: 'refreshed', detail: 'Metadata refreshed' }
      ),
    } satisfies InventoryEntry;
  });

  const refreshed: InventoryData = {
    ...existing,
    updatedAt: now,
    config: {
      ...existing.config,
      leaseSecondsDefault: leaseSeconds,
    },
    files: mergedFiles,
    totals: summarize(mergedFiles),
  };

  await persistInventory(outputPath, refreshed);
  printJson({ ok: true, output: relativeToWorkspace(outputPath), totals: refreshed.totals });
}

async function claimNext(options: CliOptions): Promise<void> {
  const result = await withInventoryLock(options.output, options.lockTimeoutMs, async () => {
    const inventory = await loadInventory(options.output);
    const now = new Date();
    releaseExpiredLeases(inventory, now);

    const entry = inventory.files.find((file) => file.status === 'pending');
    if (entry == null) {
      inventory.updatedAt = timestamp(now);
      inventory.totals = summarize(inventory.files);
      await persistInventory(options.output, inventory);
      return {
        ok: true,
        file: null,
        workerId: options.worker,
        token: null,
        remainingPending: inventory.totals.pending,
      } satisfies ClaimResult;
    }

    const claimedAt = timestamp(now);
    const token = randomUUID();
    entry.status = 'in_progress';
    entry.attempts += 1;
    entry.updatedAt = claimedAt;
    entry.lease = {
      workerId: options.worker,
      token,
      claimedAt,
      expiresAt: timestamp(new Date(now.getTime() + options.leaseSeconds * 1000)),
    };
    entry.history = appendEvent(entry.history, {
      at: claimedAt,
      action: 'claimed',
      workerId: options.worker,
      token,
    });

    inventory.updatedAt = claimedAt;
    inventory.totals = summarize(inventory.files);
    await persistInventory(options.output, inventory);

    return {
      ok: true,
      file: entry.path,
      workerId: options.worker,
      token,
      remainingPending: inventory.totals.pending,
    } satisfies ClaimResult;
  });

  printJson(result);
}

async function releaseClaim(options: CliOptions): Promise<void> {
  const result = await mutateEntry(options, (entry) => {
    entry.status = 'pending';
    entry.lease = null;
    entry.updatedAt = timestamp();
    entry.history = appendEvent(
      entry.history,
      createInventoryEvent({
        at: entry.updatedAt,
        action: 'released',
        workerId: options.worker,
        ...(options.token == null ? {} : { token: options.token }),
        detail: options.detail ?? 'Lease released manually',
      })
    );
  });

  printJson(result);
}

async function finalizeFile(
  options: CliOptions,
  status: Extract<ScanStatus, 'analyzed' | 'skipped' | 'failed'>
): Promise<void> {
  const issues = status === 'analyzed' ? await loadIssues(options) : [];
  const detail =
    status === 'failed'
      ? (options.error ?? 'Worker marked file as failed')
      : (options.detail ?? undefined);

  const result = await mutateEntry(options, (entry) => {
    entry.status = status;
    entry.lease = null;
    entry.scannedAt = timestamp();
    entry.updatedAt = entry.scannedAt;
    entry.issues = issues;
    entry.error = status === 'failed' ? (options.error ?? 'Unknown failure') : null;
    entry.history = appendEvent(
      entry.history,
      createInventoryEvent({
        at: entry.updatedAt,
        action: status === 'analyzed' ? 'completed' : status,
        workerId: options.worker,
        ...(options.token == null ? {} : { token: options.token }),
        issues: issues.length,
        ...(detail == null ? {} : { detail }),
      })
    );
  });

  printJson(result);
}

async function retryStaleClaims(outputPath: string): Promise<void> {
  const result = await withInventoryLock(outputPath, 15000, async () => {
    const inventory = await loadInventory(outputPath);
    const before = inventory.files.filter((file) => file.status === 'in_progress').length;
    releaseExpiredLeases(inventory, new Date());
    inventory.updatedAt = timestamp();
    inventory.totals = summarize(inventory.files);
    await persistInventory(outputPath, inventory);

    return {
      ok: true,
      output: relativeToWorkspace(outputPath),
      before,
      after: inventory.files.filter((file) => file.status === 'in_progress').length,
      pending: inventory.totals.pending,
    };
  });

  printJson(result);
}

async function invalidateLocalFindings(options: CliOptions): Promise<void> {
  if (options.analyzerFingerprint == null) {
    throw new TypeError('invalidate-local requires --analyzer-fingerprint');
  }

  const result = await withInventoryLock(options.output, options.lockTimeoutMs, async () => {
    const inventory = await loadInventory(options.output);
    const previousFingerprint = inventory.localAnalyzerFingerprint;
    const nextFingerprint = options.analyzerFingerprint ?? null;

    if (previousFingerprint === nextFingerprint) {
      return {
        ok: true,
        output: relativeToWorkspace(options.output),
        changed: false,
        previousFingerprint,
        nextFingerprint,
        filesReset: 0,
        clearedLocalIssues: 0,
      };
    }

    const now = timestamp();
    let filesReset = 0;
    let clearedLocalIssues = 0;

    for (const entry of inventory.files) {
      const retainedIssues = entry.issues.filter((issue) => !isLocalInventoryIssue(issue));
      const removedIssues = entry.issues.length - retainedIssues.length;
      const shouldReset =
        entry.status !== 'pending' ||
        entry.lease != null ||
        entry.scannedAt != null ||
        entry.error != null ||
        removedIssues > 0;

      if (!shouldReset) {
        continue;
      }

      clearedLocalIssues += removedIssues;
      filesReset += 1;
      entry.status = 'pending';
      entry.lease = null;
      entry.scannedAt = null;
      entry.error = null;
      entry.updatedAt = now;
      entry.issues = retainedIssues;
      entry.history = appendEvent(entry.history, {
        at: now,
        action: 'invalidated',
        workerId: options.worker,
        issues: removedIssues,
        detail:
          options.detail ??
          `Local analyzer fingerprint changed${previousFingerprint == null ? '' : '; cleared stale local findings'}`,
      });
    }

    inventory.localAnalyzerFingerprint = nextFingerprint;
    inventory.updatedAt = now;
    inventory.totals = summarize(inventory.files);
    await persistInventory(options.output, inventory);

    return {
      ok: true,
      output: relativeToWorkspace(options.output),
      changed: true,
      previousFingerprint,
      nextFingerprint,
      filesReset,
      clearedLocalIssues,
    };
  });

  printJson(result);
}

async function printSummary(outputPath: string): Promise<void> {
  const inventory = await loadInventory(outputPath);
  inventory.totals = summarize(inventory.files);
  await persistInventory(outputPath, inventory);

  const byRoot = Object.fromEntries(
    aggregateBy(inventory.files, (file) => file.root).map(([key, value]) => [key, summarize(value)])
  );

  printJson({
    ok: true,
    output: relativeToWorkspace(outputPath),
    totals: inventory.totals,
    byRoot,
  });
}

async function recordFindings(options: CliOptions): Promise<void> {
  if (options.file == null) {
    throw new TypeError('record-findings requires --file');
  }

  const issues = await loadIssues(options);
  const result = await withInventoryLock(options.output, options.lockTimeoutMs, async () => {
    const inventory = await loadInventory(options.output);
    const entry = await getOrCreateEntry(inventory, options.file ?? '');
    const now = timestamp();
    const localIssues = issues.map((issue) =>
      createInventoryIssue({
        ...issue,
        source: issue.source ?? 'inventory',
      })
    );
    const preservedExternalIssues = entry.issues.filter((issue) => !isLocalInventoryIssue(issue));

    try {
      const absolutePath = path.join(workspaceRoot, entry.path);
      const currentStat = await stat(absolutePath);
      entry.fingerprint = {
        sizeBytes: currentStat.size,
        modifiedAt: new Date(currentStat.mtimeMs).toISOString(),
      };
    } catch {
      // File might have been removed between save and rescan; keep previous fingerprint.
    }

    entry.status = 'analyzed';
    entry.lease = null;
    entry.scannedAt = now;
    entry.updatedAt = now;
    entry.error = null;
    entry.issues = dedupeIssues([...preservedExternalIssues, ...localIssues]);
    entry.history = appendEvent(entry.history, {
      at: now,
      action: 'recorded',
      workerId: options.worker,
      issues: localIssues.length,
      detail: options.detail ?? 'Recorded incrementally after file change',
    });

    inventory.updatedAt = now;
    inventory.totals = summarize(inventory.files);
    await persistInventory(options.output, inventory);

    return {
      ok: true,
      output: relativeToWorkspace(options.output),
      file: entry.path,
      status: entry.status,
      issues: entry.issues.length,
    };
  });

  printJson(result);
}

async function importFindings(options: CliOptions): Promise<void> {
  if (options.inputPath == null) {
    throw new TypeError('import-findings requires --input');
  }

  if (options.inputFormat == null) {
    throw new TypeError('import-findings requires --format');
  }

  const rawInput = await readFile(options.inputPath, 'utf8');
  const importedFindings = parseImportedFindings(
    rawInput,
    options.inputFormat,
    options.importSource
  );

  const result = await withInventoryLock(options.output, options.lockTimeoutMs, async () => {
    const inventory = await loadInventory(options.output);
    const effectiveSource =
      options.importSource ??
      (importedFindings[0]?.issue.source != null && importedFindings[0].issue.source !== ''
        ? importedFindings[0].issue.source
        : options.inputFormat);

    if (effectiveSource !== '') {
      for (const entry of inventory.files) {
        entry.issues = entry.issues.filter((issue) => issue.source !== effectiveSource);
      }
    }

    const grouped = aggregateBy(importedFindings, (finding) => finding.path);
    const now = timestamp();

    for (const [filePath, findings] of grouped) {
      const entry = await getOrCreateEntry(inventory, filePath);
      const normalizedIssues = findings.map((finding) =>
        createInventoryIssue({
          ...finding.issue,
          ...((finding.issue.source ?? effectiveSource) == null
            ? {}
            : { source: finding.issue.source ?? effectiveSource }),
        })
      );

      entry.issues = dedupeIssues([...entry.issues, ...normalizedIssues]);
      entry.status = 'analyzed';
      entry.error = null;
      entry.scannedAt = now;
      entry.updatedAt = now;
      entry.history = appendEvent(entry.history, {
        at: now,
        action: 'completed',
        issues: normalizedIssues.length,
        detail: `Imported from ${effectiveSource}`,
      });
    }

    inventory.updatedAt = now;
    inventory.totals = summarize(inventory.files);
    await persistInventory(options.output, inventory);

    return {
      ok: true,
      output: relativeToWorkspace(options.output),
      input: relativeToWorkspace(options.inputPath ?? ''),
      format: options.inputFormat,
      source: effectiveSource,
      files: grouped.length,
      findings: importedFindings.length,
    };
  });

  printJson(result);
}

async function exportFindings(outputPath: string, exportPath: string): Promise<void> {
  const inventory = await loadInventory(outputPath);
  const payload: ExportedFindings = {
    version: 1,
    exportedAt: timestamp(),
    sourceInventory: relativeToWorkspace(outputPath),
    totals: summarize(inventory.files),
    files: inventory.files
      .filter((file) => file.issues.length > 0 || file.status === 'failed')
      .map((file) => ({
        path: file.path,
        status: file.status,
        scannedAt: file.scannedAt,
        issues: file.issues,
        error: file.error,
      })),
  };

  await persistJson(exportPath, payload);
  printJson({ ok: true, export: relativeToWorkspace(exportPath), files: payload.files.length });
}

async function runDoctor(outputPath: string): Promise<void> {
  const inventory = await loadInventory(outputPath);
  const duplicatePaths = findDuplicates(inventory.files.map((file) => file.path));
  const invalidInProgress = inventory.files
    .filter((file) => file.status === 'in_progress' && file.lease == null)
    .map((file) => file.path);

  printJson({
    ok: duplicatePaths.length === 0 && invalidInProgress.length === 0,
    output: relativeToWorkspace(outputPath),
    duplicatePaths,
    invalidInProgress,
  });
}

async function mutateEntry(
  options: CliOptions,
  mutator: (entry: InventoryEntry) => void
): Promise<Record<string, unknown>> {
  return await withInventoryLock(options.output, options.lockTimeoutMs, async () => {
    const inventory = await loadInventory(options.output);
    const entry = getRequiredEntry(inventory, options.file);
    validateLease(entry, options.worker, options.token);
    mutator(entry);
    inventory.updatedAt = timestamp();
    inventory.totals = summarize(inventory.files);
    await persistInventory(options.output, inventory);

    return {
      ok: true,
      output: relativeToWorkspace(options.output),
      file: entry.path,
      status: entry.status,
      issues: entry.issues.length,
      attempts: entry.attempts,
    };
  });
}

async function withInventoryLock<T>(
  outputPath: string,
  timeoutMs: number,
  action: () => Promise<T>
): Promise<T> {
  const lockPath = `${outputPath}.lock`;
  const start = Date.now();

  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;

      if (errno.code !== 'EEXIST') {
        throw error;
      }

      if (Date.now() - start >= timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${relativeToWorkspace(outputPath)}`, {
          cause: error,
        });
      }

      await delay(125);
    }
  }

  try {
    return await action();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function loadInventory(outputPath: string): Promise<InventoryData> {
  const content = await readFile(outputPath, 'utf8');
  const parsed = JSON.parse(content) as Partial<InventoryData>;

  return {
    ...(parsed as InventoryData),
    version: typeof parsed.version === 'number' ? parsed.version : 3,
    localAnalyzerFingerprint:
      typeof parsed.localAnalyzerFingerprint === 'string' ? parsed.localAnalyzerFingerprint : null,
  };
}

async function persistInventory(outputPath: string, inventory: InventoryData): Promise<void> {
  await persistJson(outputPath, inventory);
}

async function persistJson(outputPath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(tempPath, serialized, 'utf8');
  await rename(tempPath, outputPath);
}

async function loadIssues(options: CliOptions): Promise<InventoryIssue[]> {
  if (options.issuesFile != null) {
    const content = await readFile(options.issuesFile, 'utf8');
    return parseIssues(content);
  }

  if (options.issuesJson != null) {
    return parseIssues(options.issuesJson);
  }

  return [];
}

function parseImportedFindings(
  content: string,
  format: NonNullable<CliOptions['inputFormat']>,
  sourceOverride: string | undefined
): ImportedFinding[] {
  const parsed = JSON.parse(content) as unknown;

  switch (format) {
    case 'normalized':
      return parseNormalizedImportedFindings(parsed, sourceOverride);
    case 'vscode-diagnostics':
      return parseVsCodeDiagnostics(parsed, sourceOverride);
    case 'sarif':
      return parseSarifFindings(parsed, sourceOverride);
    case 'sonar-external-issues':
      return parseSonarExternalIssues(parsed, sourceOverride);
  }
}

function parseIssues(content: string): InventoryIssue[] {
  const parsed = JSON.parse(content) as unknown;
  const candidates = extractIssueArray(parsed);
  return candidates.map((issue) => normalizeIssue(issue));
}

function parseNormalizedImportedFindings(
  parsed: unknown,
  sourceOverride: string | undefined
): ImportedFinding[] {
  let candidates: unknown[] = [];

  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed != null && typeof parsed === 'object') {
    const record = parsed as { findings?: unknown[] };
    if (Array.isArray(record.findings)) {
      candidates = record.findings;
    }
  }

  return candidates.map((candidate) => {
    if (candidate == null || typeof candidate !== 'object') {
      throw new TypeError('Normalized finding must be an object');
    }

    const finding = candidate as Record<string, unknown>;
    const targetPath = toNonEmptyString(finding['path'], 'Normalized finding requires a path');
    const issue = normalizeIssue(finding);
    issue.source = sourceOverride ?? issue.source ?? 'normalized-import';
    return { path: normalizeImportedPath(targetPath), issue };
  });
}

function parseVsCodeDiagnostics(
  parsed: unknown,
  sourceOverride: string | undefined
): ImportedFinding[] {
  if (!Array.isArray(parsed)) {
    throw new TypeError('VS Code diagnostics import requires a JSON array');
  }

  return parsed.map((candidate) => {
    if (candidate == null || typeof candidate !== 'object') {
      throw new TypeError('VS Code diagnostic must be an object');
    }

    const finding = candidate as Record<string, unknown>;
    const resource = toNonEmptyString(
      finding['resource'],
      'VS Code diagnostic requires a resource'
    );
    const codeValue = resolveDiagnosticCode(finding['code']);
    const source = sourceOverride ?? toOptionalString(finding['source']) ?? 'vscode-diagnostics';
    const owner = toOptionalString(finding['owner']);
    const engine = owner ?? toOptionalString(finding['source']);
    const severity = normalizeNumericSeverity(toOptionalNumber(finding['severity']));
    const line = toOptionalNumber(finding['startLineNumber']);
    const column = toOptionalNumber(finding['startColumn']);
    const endLine = toOptionalNumber(finding['endLineNumber']);
    const endColumn = toOptionalNumber(finding['endColumn']);
    const message = toNonEmptyString(finding['message'], 'VS Code diagnostic requires a message');

    return {
      path: normalizeImportedPath(resource),
      issue: createInventoryIssue({
        source,
        ...(owner == null ? {} : { owner }),
        ...(engine == null ? {} : { engine }),
        ...(codeValue == null ? {} : { code: codeValue, ruleId: codeValue }),
        ...(severity == null ? {} : { severity }),
        ...(line == null ? {} : { line }),
        ...(column == null ? {} : { column }),
        ...(endLine == null ? {} : { endLine }),
        ...(endColumn == null ? {} : { endColumn }),
        message,
      }),
    };
  });
}

function parseSarifFindings(
  parsed: unknown,
  sourceOverride: string | undefined
): ImportedFinding[] {
  if (
    parsed == null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { runs?: unknown[] }).runs)
  ) {
    throw new TypeError('SARIF import requires an object with runs');
  }

  const results: ImportedFinding[] = [];

  for (const run of (parsed as { runs: unknown[] }).runs) {
    const parsedRun = parseSarifRun(run, sourceOverride);
    results.push(...parsedRun);
  }

  return results;
}

function parseSonarExternalIssues(
  parsed: unknown,
  sourceOverride: string | undefined
): ImportedFinding[] {
  const issues =
    parsed != null &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { issues?: unknown[] }).issues)
      ? (parsed as { issues: unknown[] }).issues
      : [];

  return issues.map((candidate) => {
    if (candidate == null || typeof candidate !== 'object') {
      throw new TypeError('Sonar external issue must be an object');
    }

    const issueRecord = candidate as Record<string, unknown>;
    const primaryLocation =
      issueRecord['primaryLocation'] != null && typeof issueRecord['primaryLocation'] === 'object'
        ? (issueRecord['primaryLocation'] as Record<string, unknown>)
        : undefined;
    const textRange =
      primaryLocation?.['textRange'] != null && typeof primaryLocation['textRange'] === 'object'
        ? (primaryLocation['textRange'] as Record<string, unknown>)
        : undefined;

    const category = toOptionalString(issueRecord['type']);
    const ruleId = toOptionalString(issueRecord['ruleId']);
    const severity = toOptionalString(issueRecord['severity']);
    const line = toOptionalNumber(textRange?.['startLine']);
    const column = toOptionalNumber(textRange?.['startColumn']);
    const endLine = toOptionalNumber(textRange?.['endLine']);
    const endColumn = toOptionalNumber(textRange?.['endColumn']);

    return {
      path: normalizeImportedPath(
        toNonEmptyString(
          primaryLocation?.['filePath'],
          'Sonar external issue requires primaryLocation.filePath'
        )
      ),
      issue: createInventoryIssue({
        source: sourceOverride ?? 'sonar-external-issues',
        engine: toOptionalString(issueRecord['engineId']) ?? 'sonar',
        ...(category == null ? {} : { category, type: category }),
        ...(ruleId == null ? {} : { ruleId, code: ruleId }),
        ...(severity == null ? {} : { severity }),
        ...(line == null ? {} : { line }),
        ...(column == null ? {} : { column }),
        ...(endLine == null ? {} : { endLine }),
        ...(endColumn == null ? {} : { endColumn }),
        message: toNonEmptyString(
          primaryLocation?.['message'],
          'Sonar external issue requires message'
        ),
      }),
    };
  });
}

function resolveDiagnosticCode(code: unknown): string | undefined {
  if (typeof code === 'string') {
    return code;
  }

  if (code != null && typeof code === 'object') {
    const record = code as { value?: unknown };
    if (typeof record.value === 'string') {
      return record.value;
    }
  }

  return undefined;
}

function parseSarifRun(run: unknown, sourceOverride: string | undefined): ImportedFinding[] {
  if (run == null || typeof run !== 'object') {
    return [];
  }

  const runRecord = run as Record<string, unknown>;
  const toolDriver = getSarifToolDriver(runRecord);
  const engine = typeof toolDriver?.['name'] === 'string' ? toolDriver['name'] : 'sarif';
  const rules = buildSarifRulesMap(toolDriver?.['rules']);

  if (!Array.isArray(runRecord['results'])) {
    return [];
  }

  const findings: ImportedFinding[] = [];
  for (const result of runRecord['results']) {
    const finding = parseSarifResult(result, engine, rules, sourceOverride);
    if (finding != null) {
      findings.push(finding);
    }
  }

  return findings;
}

function getSarifToolDriver(
  runRecord: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (runRecord['tool'] == null || typeof runRecord['tool'] !== 'object') {
    return undefined;
  }

  const tool = runRecord['tool'] as { driver?: unknown };
  return tool.driver != null && typeof tool.driver === 'object'
    ? (tool.driver as Record<string, unknown>)
    : undefined;
}

function buildSarifRulesMap(rulesValue: unknown): Map<string, Record<string, unknown>> {
  const rules = new Map<string, Record<string, unknown>>();

  if (!Array.isArray(rulesValue)) {
    return rules;
  }

  for (const rule of rulesValue) {
    if (rule == null || typeof rule !== 'object') {
      continue;
    }

    const record = rule as { id?: unknown } & Record<string, unknown>;
    if (typeof record.id === 'string') {
      rules.set(record.id, record);
    }
  }

  return rules;
}

function parseSarifResult(
  result: unknown,
  engine: string,
  rules: Map<string, Record<string, unknown>>,
  sourceOverride: string | undefined
): ImportedFinding | null {
  if (result == null || typeof result !== 'object') {
    return null;
  }

  const resultRecord = result as Record<string, unknown>;
  const location = getSarifLocation(resultRecord);
  if (location == null) {
    return null;
  }

  const ruleId = toOptionalString(resultRecord['ruleId']);
  const rule = ruleId == null ? undefined : rules.get(ruleId);
  const message = getSarifMessage(resultRecord);
  const category = toOptionalString(resultRecord['kind']);
  const type = getSarifRuleType(rule);
  const severity = toOptionalString(resultRecord['level']) ?? 'warning';
  const line = toOptionalNumber(location.region?.['startLine']);
  const column = toOptionalNumber(location.region?.['startColumn']);
  const endLine = toOptionalNumber(location.region?.['endLine']);
  const endColumn = toOptionalNumber(location.region?.['endColumn']);

  return {
    path: normalizeImportedPath(location.uri),
    issue: createInventoryIssue({
      source: sourceOverride ?? 'sarif',
      engine,
      ...(category == null ? {} : { category }),
      ...(type == null ? {} : { type }),
      ...(ruleId == null ? {} : { ruleId, code: ruleId }),
      severity,
      ...(line == null ? {} : { line }),
      ...(column == null ? {} : { column }),
      ...(endLine == null ? {} : { endLine }),
      ...(endColumn == null ? {} : { endColumn }),
      message,
    }),
  };
}

function getSarifLocation(
  resultRecord: Record<string, unknown>
): { uri: string; region?: Record<string, unknown> } | null {
  const locations: unknown[] = Array.isArray(resultRecord['locations'])
    ? resultRecord['locations']
    : [];
  const firstLocation: unknown = locations[0];

  if (firstLocation == null || typeof firstLocation !== 'object') {
    return null;
  }

  const physicalLocation =
    (firstLocation as { physicalLocation?: unknown }).physicalLocation != null &&
    typeof (firstLocation as { physicalLocation?: unknown }).physicalLocation === 'object'
      ? (firstLocation as { physicalLocation: Record<string, unknown> }).physicalLocation
      : undefined;

  if (physicalLocation == null) {
    return null;
  }

  const artifactLocation =
    physicalLocation['artifactLocation'] != null &&
    typeof physicalLocation['artifactLocation'] === 'object'
      ? (physicalLocation['artifactLocation'] as Record<string, unknown>)
      : undefined;
  const uri = typeof artifactLocation?.['uri'] === 'string' ? artifactLocation['uri'] : undefined;

  if (uri == null || uri.trim() === '') {
    return null;
  }

  const region =
    physicalLocation['region'] != null && typeof physicalLocation['region'] === 'object'
      ? (physicalLocation['region'] as Record<string, unknown>)
      : undefined;

  return region == null ? { uri } : { uri, region };
}

function getSarifMessage(resultRecord: Record<string, unknown>): string {
  if (resultRecord['message'] != null && typeof resultRecord['message'] === 'object') {
    const text = toOptionalString((resultRecord['message'] as { text?: unknown }).text);
    if (text != null) {
      return text;
    }
  }

  return 'SARIF finding without message text';
}

function getSarifRuleType(rule: Record<string, unknown> | undefined): string | undefined {
  if (rule == null) {
    return undefined;
  }

  const properties = rule['properties'];
  if (properties != null && typeof properties === 'object') {
    const record = properties as Record<string, unknown>;
    return (
      toOptionalString(record['problem']?.toString?.()) ?? toOptionalString(record['category'])
    );
  }

  return undefined;
}

function extractIssueArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed != null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;

    if (Array.isArray(record['issues'])) {
      return record['issues'];
    }

    if (Array.isArray(record['errors'])) {
      return record['errors'];
    }
  }

  throw new TypeError('Issues payload must be a JSON array or an object containing issues/errors');
}

function normalizeIssue(issue: unknown): InventoryIssue {
  if (issue == null || typeof issue !== 'object') {
    throw new TypeError('Each issue must be an object');
  }

  const candidate = issue as Record<string, unknown>;
  const message = toNonEmptyString(
    candidate['message'],
    'Each issue must include a non-empty message'
  );

  const source = toOptionalString(candidate['source']);
  const engine = toOptionalString(candidate['engine']);
  const owner = toOptionalString(candidate['owner']);
  const category = toOptionalString(candidate['category']);
  const type = toOptionalString(candidate['type']);
  const ruleId = toOptionalString(candidate['ruleId'] ?? candidate['rule']);
  const code = toOptionalString(candidate['code']);
  const severity = toOptionalString(candidate['severity']);
  const line = toOptionalNumber(candidate['line']);
  const column = toOptionalNumber(candidate['column']);
  const endLine = toOptionalNumber(candidate['endLine']);
  const endColumn = toOptionalNumber(candidate['endColumn']);
  const evidence = toOptionalString(candidate['evidence']);

  return createInventoryIssue({
    ...(source == null ? {} : { source }),
    ...(engine == null ? {} : { engine }),
    ...(owner == null ? {} : { owner }),
    ...(category == null ? {} : { category }),
    ...(type == null ? {} : { type }),
    ...(ruleId == null ? {} : { ruleId }),
    ...(code == null ? {} : { code }),
    ...(severity == null ? {} : { severity }),
    ...(line == null ? {} : { line }),
    ...(column == null ? {} : { column }),
    ...(endLine == null ? {} : { endLine }),
    ...(endColumn == null ? {} : { endColumn }),
    ...(evidence == null ? {} : { evidence }),
    message,
  });
}

function dedupeIssues(issues: InventoryIssue[]): InventoryIssue[] {
  const seen = new Set<string>();
  const deduped: InventoryIssue[] = [];

  for (const issue of issues) {
    const key = [
      issue.source ?? '',
      issue.ruleId ?? issue.code ?? '',
      String(issue.line ?? 0),
      String(issue.column ?? 0),
      issue.message,
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
}

function isLocalInventoryIssue(issue: InventoryIssue): boolean {
  return localFindingSources.has(issue.source ?? 'inventory');
}

function summarize(files: InventoryEntry[]): InventoryTotals {
  const totals: InventoryTotals = {
    discovered: files.length,
    pending: 0,
    in_progress: 0,
    analyzed: 0,
    skipped: 0,
    failed: 0,
    issues: 0,
  };

  for (const file of files) {
    totals[file.status] += 1;
    totals.issues += file.issues.length;
  }

  return totals;
}

function emptyTotals(): InventoryTotals {
  return {
    discovered: 0,
    pending: 0,
    in_progress: 0,
    analyzed: 0,
    skipped: 0,
    failed: 0,
    issues: 0,
  };
}

async function discoverFiles(): Promise<InventoryEntry[]> {
  const collected = new Map<string, InventoryEntry>();

  for (const root of includeRoots) {
    const absoluteRoot = path.join(workspaceRoot, root);

    try {
      const rootStat = await stat(absoluteRoot);
      if (!rootStat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    for await (const filePath of walkDirectory(absoluteRoot)) {
      const relativePath = relativeToWorkspace(filePath);
      collected.set(relativePath, await buildEntry(filePath));
    }
  }

  for (const filePath of includeFiles) {
    const absolutePath = path.join(workspaceRoot, filePath);

    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        continue;
      }
      collected.set(filePath, await buildEntry(absolutePath));
    } catch {
      continue;
    }
  }

  return [...collected.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function buildEntry(absolutePath: string): Promise<InventoryEntry> {
  const fileStat = await stat(absolutePath);
  const relativePath = relativeToWorkspace(absolutePath);
  const extension = path.extname(relativePath);
  const now = timestamp();

  return {
    id: createHash('sha1').update(relativePath).digest('hex'),
    path: relativePath,
    root: getEntryRoot(relativePath),
    extension,
    status: 'pending',
    attempts: 0,
    fingerprint: {
      sizeBytes: fileStat.size,
      modifiedAt: new Date(fileStat.mtimeMs).toISOString(),
    },
    lease: null,
    scannedAt: null,
    updatedAt: now,
    issues: [],
    error: null,
    history: [{ at: now, action: 'discovered' }],
  };
}

async function getOrCreateEntry(
  inventory: InventoryData,
  filePath: string
): Promise<InventoryEntry> {
  const normalizedPath = normalizeImportedPath(filePath);
  const existing = inventory.files.find((candidate) => candidate.path === normalizedPath);

  if (existing != null) {
    return existing;
  }

  const absolutePath = path.isAbsolute(normalizedPath)
    ? normalizedPath
    : path.join(workspaceRoot, normalizedPath);

  let entry: InventoryEntry;
  try {
    entry = await buildEntry(absolutePath);
  } catch {
    const now = timestamp();
    entry = {
      id: createHash('sha1').update(normalizedPath).digest('hex'),
      path: normalizedPath,
      root: getEntryRoot(normalizedPath),
      extension: path.extname(normalizedPath),
      status: 'pending',
      attempts: 0,
      fingerprint: {
        sizeBytes: 0,
        modifiedAt: now,
      },
      lease: null,
      scannedAt: null,
      updatedAt: now,
      issues: [],
      error: null,
      history: [{ at: now, action: 'discovered', detail: 'Imported external file' }],
    };
  }

  inventory.files.push(entry);
  inventory.files.sort((left, right) => left.path.localeCompare(right.path));
  return entry;
}

async function* walkDirectory(directoryPath: string): AsyncGenerator<string> {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    const relativePath = relativeToWorkspace(absolutePath);

    if (isExcluded(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      yield* walkDirectory(absolutePath);
      continue;
    }

    if (entry.isFile() && includeExtensions.has(path.extname(entry.name))) {
      yield absolutePath;
    }
  }
}

function isExcluded(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return segments.some((segment) => excludedSegments.has(segment));
}

function releaseExpiredLeases(inventory: InventoryData, now: Date): void {
  const nowMs = now.getTime();

  for (const entry of inventory.files) {
    if (entry.status !== 'in_progress' || entry.lease == null) {
      continue;
    }

    if (new Date(entry.lease.expiresAt).getTime() > nowMs) {
      continue;
    }

    entry.status = 'pending';
    entry.updatedAt = timestamp(now);
    entry.history = appendEvent(entry.history, {
      at: entry.updatedAt,
      action: 'lease_expired',
      workerId: entry.lease.workerId,
      token: entry.lease.token,
    });
    entry.lease = null;
  }
}

function validateLease(entry: InventoryEntry, workerId: string, token: string | undefined): void {
  if (entry.lease == null) {
    throw new Error(`File is not currently claimed: ${entry.path}`);
  }

  if (entry.lease.workerId !== workerId) {
    throw new Error(`Lease worker mismatch for ${entry.path}`);
  }

  if (token == null || entry.lease.token !== token) {
    throw new Error(`Lease token mismatch for ${entry.path}`);
  }
}

function getRequiredEntry(inventory: InventoryData, targetPath = ''): InventoryEntry {
  const filePath = targetPath;
  const entry = inventory.files.find((candidate) => candidate.path === filePath);

  if (entry == null) {
    throw new Error(`File not found in inventory: ${filePath}`);
  }

  return entry;
}

function aggregateBy<T>(items: T[], keyFn: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyFn(item);
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function findDuplicates(values: string[]): string[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort((left, right) => left.localeCompare(right));
}

function hasFingerprintChanged(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.sizeBytes !== right.sizeBytes || left.modifiedAt !== right.modifiedAt;
}

function createInventoryIssue(
  issue: Pick<InventoryIssue, 'message'> & Partial<Omit<InventoryIssue, 'message'>>
): InventoryIssue {
  const normalized: InventoryIssue = {
    message: issue.message,
  };

  if (issue.source != null) normalized.source = issue.source;
  if (issue.engine != null) normalized.engine = issue.engine;
  if (issue.owner != null) normalized.owner = issue.owner;
  if (issue.category != null) normalized.category = issue.category;
  if (issue.type != null) normalized.type = issue.type;
  if (issue.ruleId != null) normalized.ruleId = issue.ruleId;
  if (issue.code != null) normalized.code = issue.code;
  if (issue.severity != null) normalized.severity = issue.severity;
  if (issue.line != null) normalized.line = issue.line;
  if (issue.column != null) normalized.column = issue.column;
  if (issue.endLine != null) normalized.endLine = issue.endLine;
  if (issue.endColumn != null) normalized.endColumn = issue.endColumn;
  if (issue.evidence != null) normalized.evidence = issue.evidence;

  return normalized;
}

function createInventoryEvent(
  event: Pick<InventoryEvent, 'at' | 'action'> & Partial<Omit<InventoryEvent, 'at' | 'action'>>
): InventoryEvent {
  const normalized: InventoryEvent = {
    at: event.at,
    action: event.action,
  };

  if (event.workerId != null) normalized.workerId = event.workerId;
  if (event.token != null) normalized.token = event.token;
  if (event.issues != null) normalized.issues = event.issues;
  if (event.detail != null) normalized.detail = event.detail;

  return normalized;
}

function getEntryRoot(relativePath: string): string {
  if (!relativePath.includes('/')) {
    return '.';
  }

  return relativePath.split('/')[0] ?? '.';
}

function appendEvent(history: InventoryEvent[], event: InventoryEvent): InventoryEvent[] {
  const next = [...history, event];
  return next.slice(-20);
}

function resolveWithinWorkspace(targetPath: string | undefined, flag: string): string {
  const resolved = parseRequiredString(targetPath, flag);
  return path.isAbsolute(resolved) ? resolved : path.join(workspaceRoot, resolved);
}

function parseRequiredString(value: string | undefined, flag: string): string {
  if (value == null || value.trim() === '') {
    throw new TypeError(`Missing value for ${flag}`);
  }

  return value.trim();
}

function parseIntegerOption(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(parseRequiredString(value, flag), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${flag} must be a positive integer`);
  }

  return parsed;
}

function parseImportFormat(value: string | undefined): NonNullable<CliOptions['inputFormat']> {
  const format = parseRequiredString(value, '--format');

  if (
    format !== 'normalized' &&
    format !== 'vscode-diagnostics' &&
    format !== 'sarif' &&
    format !== 'sonar-external-issues'
  ) {
    throw new RangeError(
      'Unsupported import format. Use normalized, vscode-diagnostics, sarif, or sonar-external-issues'
    );
  }

  return format;
}

function toNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(message);
  }

  return value;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeImportedPath(targetPath: string): string {
  if (targetPath.startsWith('file://')) {
    return normalizeImportedPath(new URL(targetPath).pathname);
  }

  const absolutePath = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(workspaceRoot, targetPath);
  return normalizePath(path.relative(workspaceRoot, absolutePath));
}

function normalizeNumericSeverity(value: number | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (value >= 8) {
    return 'critical';
  }

  if (value >= 4) {
    return 'major';
  }

  if (value >= 2) {
    return 'minor';
  }

  return 'info';
}

function relativeToWorkspace(targetPath: string): string {
  return normalizePath(path.relative(workspaceRoot, targetPath));
}

function normalizePath(targetPath: string): string {
  return targetPath.split(path.sep).join('/');
}

function timestamp(date = new Date()): string {
  return date.toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
