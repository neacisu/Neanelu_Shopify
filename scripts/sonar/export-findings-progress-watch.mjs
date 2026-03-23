import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';

const workspaceRoot = process.cwd();
const inventoryPath = path.join(workspaceRoot, 'temp', 'sonar-manual-inventory.json');
const inventoryDir = path.dirname(inventoryPath);
const inventoryFileName = path.basename(inventoryPath);
const workerScript = path.join(workspaceRoot, 'scripts', 'sonar', 'manual-inventory-worker.ts');
const debounceMs = Number.parseInt(process.env['SONAR_EXPORT_PROGRESS_DEBOUNCE_MS'] ?? '250', 10);
const beginMarker = '__SONAR_EXPORT_PROGRESS_BEGIN__';
const endMarker = '__SONAR_EXPORT_PROGRESS_END__';

/** @type {ReturnType<typeof setNodeTimeout> | null} */
let debounceTimer = null;
let refreshInFlight = Promise.resolve();
/** @type {{ analyzed: number; failed: number; issues: number; pending: number; inProgress: number } | null} */
let lastExported = null;

function scheduleRefresh() {
  if (debounceTimer !== null) {
    clearNodeTimeout(debounceTimer);
  }

  debounceTimer = setNodeTimeout(() => {
    debounceTimer = null;
    enqueueRefresh();
  }, debounceMs);
}

function enqueueRefresh() {
  refreshInFlight = refreshInFlight.then(async () => {
    const state = await readInventoryTotals();
    if (state == null) {
      return;
    }

    if (!shouldExport(state)) {
      if (isComplete(state)) {
        console.log('[sonar:export-progress-watch] scan complete; no new export needed');
        watcher.close();
        process.exit(0);
      }
      return;
    }

    console.log(beginMarker);
    try {
      await execProcess('node', ['--import', 'tsx', workerScript, 'export'], workspaceRoot);
      lastExported = state;
      console.log(
        `[sonar:export-progress-watch] exported findings at analyzed=${state.analyzed}, pending=${state.pending}, in_progress=${state.inProgress}, issues=${state.issues}`
      );

      if (isComplete(state)) {
        console.log('[sonar:export-progress-watch] scan complete; watcher exiting');
        watcher.close();
        process.exit(0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown export-progress error';
      console.error(`[sonar:export-progress-watch] ${message}`);
    } finally {
      console.log(endMarker);
    }
  });
}

function shouldExport(state) {
  if (lastExported == null) {
    return true;
  }

  return (
    state.analyzed !== lastExported.analyzed ||
    state.failed !== lastExported.failed ||
    state.issues !== lastExported.issues ||
    (isComplete(state) && !isComplete(lastExported))
  );
}

function isComplete(state) {
  return state.pending === 0 && state.inProgress === 0;
}

async function readInventoryTotals() {
  try {
    const raw = await readFile(inventoryPath, 'utf8');
    const parsed = JSON.parse(raw);
    const totals = parsed?.totals ?? {};

    return {
      analyzed: Number(totals.analyzed ?? 0),
      failed: Number(totals.failed ?? 0),
      issues: Number(totals.issues ?? 0),
      pending: Number(totals.pending ?? 0),
      inProgress: Number(totals.in_progress ?? 0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown inventory read error';
    console.error(`[sonar:export-progress-watch] ${message}`);
    return null;
  }
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

const watcher = watch(inventoryDir, { persistent: true }, (eventType, fileName) => {
  if (fileName == null || fileName.toString() !== inventoryFileName) {
    return;
  }

  if (eventType === 'change' || eventType === 'rename') {
    scheduleRefresh();
  }
});

process.on('SIGINT', () => {
  watcher.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  watcher.close();
  process.exit(0);
});

enqueueRefresh();
