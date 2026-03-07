import { cwd, exit, stdin } from 'node:process';
import { resolve } from 'node:path';

function readStdin() {
  return new Promise((resolveInput, reject) => {
    let input = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      input += chunk;
    });
    stdin.on('end', () => resolveInput(input));
    stdin.on('error', reject);
  });
}

function extractJson(text) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Unable to locate pnpm audit JSON payload in command output.');
  }
  return text.slice(firstBrace, lastBrace + 1);
}

function toWorkspacePackagePath(findingPath) {
  const firstSegment = String(findingPath ?? '').split('>')[0];
  if (firstSegment.startsWith('apps__')) {
    return resolve(cwd(), 'apps', firstSegment.slice('apps__'.length), 'package.json');
  }
  if (firstSegment.startsWith('packages__')) {
    return resolve(cwd(), 'packages', firstSegment.slice('packages__'.length), 'package.json');
  }
  return resolve(cwd(), 'package.json');
}

function severityToProblemSeverity(severity) {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'moderate':
    case 'medium':
    case 'low':
      return 'warning';
    default:
      return 'info';
  }
}

function collectAdvisories(parsed) {
  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed.advisories &&
    typeof parsed.advisories === 'object'
  ) {
    return Object.values(parsed.advisories);
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed.vulnerabilities &&
    typeof parsed.vulnerabilities === 'object'
  ) {
    return Object.entries(parsed.vulnerabilities)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([name, value]) => ({
        title: value.title ?? `${name} vulnerability`,
        module_name: name,
        severity: value.severity ?? 'info',
        recommendation: value.fixAvailable
          ? 'A fix is available via pnpm audit.'
          : 'Review dependency tree and upgrade path manually.',
        findings: Array.isArray(value.via)
          ? value.via
              .filter((entry) => entry && typeof entry === 'object')
              .map((entry) => ({
                paths: [entry.source ?? '.'],
              }))
          : [],
        cves: Array.isArray(value.cves) ? value.cves : [],
      }));
  }

  return [];
}

try {
  const raw = await readStdin();
  const parsed = JSON.parse(extractJson(raw));
  const advisories = collectAdvisories(parsed);

  if (advisories.length === 0) {
    exit(0);
  }

  for (const advisory of advisories) {
    const severity = severityToProblemSeverity(advisory.severity);
    const firstFinding = Array.isArray(advisory.findings) ? advisory.findings[0] : undefined;
    const firstPath = firstFinding?.paths?.[0] ?? '.';
    const targetFile = toWorkspacePackagePath(firstPath);
    const recommendation = advisory.recommendation
      ? ` Recommendation: ${advisory.recommendation}`
      : '';
    const cves =
      Array.isArray(advisory.cves) && advisory.cves.length > 0
        ? ` CVE: ${advisory.cves.join(', ')}.`
        : '';
    const message = `[pnpm audit] ${String(advisory.module_name ?? 'dependency')} ${String(advisory.severity ?? 'info')}: ${String(advisory.title ?? 'Security advisory detected.')}.${cves}${recommendation}`;

    console.log(`${targetFile}:1:1: ${severity}: ${message}`);
  }

  exit(1);
} catch (error) {
  console.error(
    `${resolve(cwd(), 'package.json')}:1:1: error: [pnpm audit] ${error instanceof Error ? error.message : String(error)}`
  );
  exit(2);
}
