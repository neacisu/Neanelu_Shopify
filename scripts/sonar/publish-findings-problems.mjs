import { readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const findingsPath = path.join(workspaceRoot, 'temp', 'sonar-manual-findings.json');

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
    console.log(`${absolutePath}:${line}:${column}: ${severity}: [${source}/${code}] ${message}`);
  }
}
