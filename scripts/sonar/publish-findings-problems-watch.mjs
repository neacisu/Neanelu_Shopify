import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';

const workspaceRoot = process.cwd();
const findingsPath = path.join(workspaceRoot, 'temp', 'sonar-manual-findings.json');
const findingsDir = path.dirname(findingsPath);
const findingsFileName = path.basename(findingsPath);
const cycleBegin = '__SONAR_MANUAL_FINDINGS_BEGIN__';
const cycleEnd = '__SONAR_MANUAL_FINDINGS_END__';

/** @type {ReturnType<typeof setNodeTimeout> | null} */
let debounceTimer = null;
let refreshInFlight = Promise.resolve();

function normalizeSeverity(value) {
  const normalized = String(value ?? 'warning').toLowerCase();
  if (normalized === 'critical' || normalized === 'major' || normalized === 'error') {
    return 'error';
  }
  if (normalized === 'info') {
    return 'note';
  }
  return 'warning';
}

function enqueueRefresh() {
  refreshInFlight = refreshInFlight.then(async () => {
    console.log(cycleBegin);

    try {
      const raw = await readFile(findingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      const files = Array.isArray(parsed.files) ? parsed.files : [];

      for (const file of files) {
        const absolutePath = path.join(workspaceRoot, file.path);
        const issues = Array.isArray(file.issues) ? file.issues : [];

        for (const issue of issues) {
          const line = Number(issue.line ?? 1);
          const column = Number(issue.column ?? 1);
          const severity = normalizeSeverity(issue.severity);
          const source = issue.source ?? issue.engine ?? 'inventory';
          const code = issue.ruleId ?? issue.code ?? 'finding';
          const message = String(issue.message ?? 'Unknown issue').replaceAll('\n', ' ');
          console.log(
            `${absolutePath}:${line}:${column}: ${severity}: [${source}/${code}] ${message}`
          );
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message.replaceAll('\n', ' ') : 'Unknown watch error';
      console.log(`${findingsPath}:1:1: error: [inventory/watch] ${message}`);
    }

    console.log(cycleEnd);
  });
}

function scheduleRefresh() {
  if (debounceTimer !== null) {
    clearNodeTimeout(debounceTimer);
  }

  debounceTimer = setNodeTimeout(() => {
    debounceTimer = null;
    enqueueRefresh();
  }, 200);
}

const watcher = watch(findingsDir, { persistent: true }, (eventType, fileName) => {
  if (fileName == null || fileName.toString() !== findingsFileName) {
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
