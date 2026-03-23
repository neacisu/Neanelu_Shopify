import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delayTimer } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const workspaceRoot = process.cwd();
const inventoryPath = path.join(workspaceRoot, 'temp', 'sonar-manual-inventory.json');
const workerScript = path.join(workspaceRoot, 'scripts', 'sonar', 'manual-inventory-worker.ts');
const analyzerScript = path.join(
  workspaceRoot,
  'scripts',
  'sonar',
  'persistent-findings-analyzer.ts'
);
const pollIntervalMs = Number.parseInt(process.env['SONAR_RESCAN_POLL_MS'] ?? '2000', 10);
const refreshEveryLoops = Number.parseInt(process.env['SONAR_RESCAN_REFRESH_LOOPS'] ?? '30', 10);
const beginMarker = '__SONAR_INCREMENTAL_RESCAN_BEGIN__';
const readyMarker = '__SONAR_INCREMENTAL_RESCAN_READY__';

let running = true;
let loopCount = 0;
let knownFiles = new Map();
let queue = [];
let queuedSet = new Set();
let processing = false;
/** @type {string | null} */
let localAnalyzerFingerprint = null;

process.on('SIGINT', () => {
  running = false;
});

process.on('SIGTERM', () => {
  running = false;
});

console.log(beginMarker);
console.log(readyMarker);

await initialLoad();

while (running) {
  try {
    await maybeRefreshInventory();
    await detectChanges();
    await flushQueue();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown incremental watch error';
    console.error(`[sonar:rescan-watch] ${message}`);
  }

  await delay(pollIntervalMs);
}

async function initialLoad() {
  localAnalyzerFingerprint = await computeLocalAnalyzerFingerprint();
  await loadInventorySnapshot();
  await ensureLocalAnalyzerFreshness();
}

async function maybeRefreshInventory() {
  loopCount += 1;
  if (loopCount % refreshEveryLoops !== 0) {
    return;
  }

  await execProcess('node', ['--import', 'tsx', workerScript, 'refresh'], workspaceRoot);
  await loadInventorySnapshot();
}

async function loadInventorySnapshot() {
  const raw = await readFile(inventoryPath, 'utf8');
  const parsed = JSON.parse(raw);
  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const nextKnown = new Map();

  for (const file of files) {
    const relativePath = String(file.path ?? '');
    if (relativePath === '') {
      continue;
    }

    const absolutePath = path.join(workspaceRoot, relativePath);
    const fingerprint = file.fingerprint ?? {};
    nextKnown.set(relativePath, {
      absolutePath,
      mtime: String(fingerprint.modifiedAt ?? ''),
      sizeBytes: Number(fingerprint.sizeBytes ?? 0),
    });
  }

  knownFiles = nextKnown;
}

async function detectChanges() {
  for (const [relativePath, state] of knownFiles) {
    try {
      const currentStat = await stat(state.absolutePath);
      const currentMtime = new Date(currentStat.mtimeMs).toISOString();
      const currentSize = currentStat.size;

      if (currentMtime === state.mtime && currentSize === state.sizeBytes) {
        continue;
      }

      state.mtime = currentMtime;
      state.sizeBytes = currentSize;
      enqueue(relativePath);
    } catch {
      // File may be temporarily missing while being rewritten; retry on next poll.
    }
  }
}

function enqueue(relativePath) {
  if (queuedSet.has(relativePath)) {
    return;
  }

  queuedSet.add(relativePath);
  queue.push(relativePath);
}

async function flushQueue() {
  if (processing || queue.length === 0) {
    return;
  }

  processing = true;

  try {
    while (queue.length > 0) {
      const relativePath = queue.shift();
      queuedSet.delete(relativePath);
      await reanalyzeFile(relativePath);
    }
  } finally {
    processing = false;
  }
}

async function reanalyzeFile(relativePath) {
  const fileState = knownFiles.get(relativePath);
  if (!fileState) {
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sonar-incremental-'));
  const issuesPath = path.join(tempDir, 'issues.json');

  try {
    await execProcess(
      'node',
      ['--import', 'tsx', analyzerScript, '--file', fileState.absolutePath, '--issues', issuesPath],
      workspaceRoot
    );
    await execProcess(
      'node',
      [
        '--import',
        'tsx',
        workerScript,
        'record-findings',
        '--worker',
        'incremental-rescan-watch',
        '--file',
        relativePath,
        '--issues-file',
        issuesPath,
        '--detail',
        'Incremental reanalysis after file save',
      ],
      workspaceRoot
    );
    await execProcess('node', ['--import', 'tsx', workerScript, 'export'], workspaceRoot);
    console.log(`[sonar:rescan-watch] reanalyzed ${relativePath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown reanalysis error';
    console.error(`[sonar:rescan-watch] failed ${relativePath}: ${message}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function ensureLocalAnalyzerFreshness() {
  const raw = await readFile(inventoryPath, 'utf8');
  const inventory = JSON.parse(raw);
  const previousFingerprint =
    typeof inventory.localAnalyzerFingerprint === 'string'
      ? inventory.localAnalyzerFingerprint
      : null;

  if (previousFingerprint === localAnalyzerFingerprint) {
    return;
  }

  await execProcess(
    'node',
    [
      '--import',
      'tsx',
      workerScript,
      'invalidate-local',
      '--worker',
      'incremental-rescan-watch',
      '--analyzer-fingerprint',
      localAnalyzerFingerprint,
      '--detail',
      previousFingerprint == null
        ? 'Seeded local analyzer fingerprint and invalidated legacy local findings'
        : 'Local analyzer fingerprint changed; invalidated stale local findings',
    ],
    workspaceRoot
  );
  await execProcess('node', ['--import', 'tsx', workerScript, 'export'], workspaceRoot);
  await loadInventorySnapshot();

  for (const relativePath of knownFiles.keys()) {
    enqueue(relativePath);
  }

  console.log(
    `[sonar:rescan-watch] invalidated stale local findings for analyzer fingerprint ${localAnalyzerFingerprint.slice(0, 12)}`
  );
}

async function computeLocalAnalyzerFingerprint() {
  const hash = createHash('sha256');
  const files = await collectFingerprintFiles();

  for (const filePath of files) {
    hash.update(`${path.relative(workspaceRoot, filePath)}\n`);
    try {
      hash.update(await readFile(filePath, 'utf8'));
    } catch {
      hash.update('__missing__');
    }
    hash.update('\n');
  }

  return hash.digest('hex');
}

async function collectFingerprintFiles() {
  const staticFiles = [
    path.join(workspaceRoot, 'scripts', 'sonar', 'persistent-findings-analyzer.ts'),
    path.join(workspaceRoot, 'eslint.config.js'),
    path.join(workspaceRoot, 'tsconfig.eslint.json'),
    path.join(workspaceRoot, 'tsconfig.json'),
    path.join(workspaceRoot, 'tsconfig.base.json'),
    path.join(workspaceRoot, '.markdownlint.json'),
  ];
  const dynamicFiles = await collectRecursiveMatches([
    path.join(workspaceRoot, 'apps'),
    path.join(workspaceRoot, 'packages'),
  ]);

  return [...new Set([...staticFiles, ...dynamicFiles])].sort((left, right) =>
    left.localeCompare(right)
  );
}

async function collectRecursiveMatches(rootDirectories) {
  const matches = [];

  for (const rootDirectory of rootDirectories) {
    matches.push(...(await walkForTsconfigFiles(rootDirectory)));
  }

  return matches;
}

async function walkForTsconfigFiles(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const matches = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
        continue;
      }

      matches.push(...(await walkForTsconfigFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && /^tsconfig(\..+)?\.json$/u.test(entry.name)) {
      matches.push(absolutePath);
    }
  }

  return matches;
}

async function execProcess(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function delay(ms) {
  await delayTimer(ms);
}
