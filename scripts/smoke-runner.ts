import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type SmokeTest = Readonly<{
  id: string;
  flag: string;
  filePathAbs: string;
  packageName: string;
  packageRootAbs: string;
  nodeArgs: readonly string[];
}>;

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

function isTruthyEnv(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function sanitizeId(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

async function fileExists(filePathAbs: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePathAbs);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function findWorkspaceSmokeTests(rootAbs: string): Promise<string[]> {
  // Convention: any node:test file whose filename contains "smoke".
  // (Keeps discovery fast and avoids parsing all tests.)
  const candidates: string[] = [];
  const ignoreDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.turbo',
    '.next',
    'coverage',
  ]);

  async function walk(dirAbs: string): Promise<void> {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    await Promise.all(
      entries.map(async (ent) => {
        const abs = path.join(dirAbs, ent.name);
        if (ent.isDirectory()) {
          if (ignoreDirs.has(ent.name)) return;
          await walk(abs);
          return;
        }

        if (!ent.isFile()) return;
        const lower = ent.name.toLowerCase();
        if (!lower.includes('smoke')) return;
        if (!lower.endsWith('.test.ts') && !lower.endsWith('.spec.ts')) return;
        candidates.push(abs);
      })
    );
  }

  await walk(rootAbs);

  // Stable order for CI.
  candidates.sort();
  return candidates;
}

async function findNearestPackageJson(startAbs: string): Promise<string | null> {
  let curr = path.dirname(startAbs);
  for (let i = 0; i < 25; i += 1) {
    const pkg = path.join(curr, 'package.json');
    if (await fileExists(pkg)) return pkg;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

async function readPackageMeta(packageJsonAbs: string): Promise<{ name: string; rootAbs: string }> {
  const raw = await fs.readFile(packageJsonAbs, 'utf8');
  const parsed = JSON.parse(raw) as { name?: unknown };
  const name = typeof parsed.name === 'string' ? parsed.name : '';
  if (!name) throw new Error(`Invalid package.json (missing name): ${packageJsonAbs}`);
  return { name, rootAbs: path.dirname(packageJsonAbs) };
}

function buildNodeArgsForPackage(packageName: string, testFileRel: string): readonly string[] {
  // Keep this aligned with each package's test runner conventions.
  // backend-worker uses module mocks in several tests.
  // Use --test-force-exit so CI doesn't hang on open handles if a smoke test fails.
  const base: string[] = [
    '--import',
    'tsx',
    '--test',
    '--test-force-exit',
    '--test-name-pattern=smoke',
    testFileRel,
  ];
  if (packageName === '@app/backend-worker') {
    return ['--experimental-test-module-mocks', ...base];
  }
  return base;
}

function deriveSmokeId(packageName: string, testFileAbs: string): string {
  const base = path.basename(testFileAbs);
  // Strip common suffixes.
  const cleaned = base
    .replace(/\.(test|spec)\.ts$/i, '')
    .replace(/-?smoke$/i, '')
    .replace(/-?smoke-?/i, '-');

  const pkgPart = packageName
    .replace(/^@/g, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '-');

  return sanitizeId(`${pkgPart}_${cleaned}`);
}

function getSelectedFlags(): Set<string> {
  const selected = new Set<string>();
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('SMOKE_')) continue;
    if (k === 'SMOKE_RUN') continue;
    if (isTruthyEnv(v)) selected.add(k);
  }
  return selected;
}

async function buildSmokePlan(rootAbs: string): Promise<SmokeTest[]> {
  const files = await findWorkspaceSmokeTests(rootAbs);
  const tests: SmokeTest[] = [];

  for (const fileAbs of files) {
    const pkgJson = await findNearestPackageJson(fileAbs);
    if (!pkgJson) continue;

    const pkg = await readPackageMeta(pkgJson);
    const relToPkg = path.relative(pkg.rootAbs, fileAbs);

    const id = deriveSmokeId(pkg.name, fileAbs);
    const flag = `SMOKE_${id}`;

    tests.push({
      id,
      flag,
      filePathAbs: fileAbs,
      packageName: pkg.name,
      packageRootAbs: pkg.rootAbs,
      nodeArgs: buildNodeArgsForPackage(pkg.name, relToPkg),
    });
  }

  // Ensure deterministic order and avoid duplicates.
  const unique = new Map<string, SmokeTest>();
  for (const t of tests) unique.set(t.id, t);

  return Array.from(unique.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function runCommand(cmd: string, args: string[], cwd: string): Promise<number> {
  const child = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      // Ensure all smoke tests can detect the dedicated smoke run.
      SMOKE_RUN: '1',
    },
    stdio: 'inherit',
  });

  return await new Promise<number>((resolve) => {
    child.on('close', (code, signal) => {
      if (signal) return resolve(1);
      resolve(code ?? 1);
    });
  });
}

function printHelp(): void {
  out(`smoke-runner

Usage:
  pnpm smoke
  pnpm smoke -- --list

Selection via env flags:
  Set one or more SMOKE_<ID>=1 to run only those.
  Example:
    SMOKE_APP_BACKEND_WORKER_BULK_OPERATIONS_ORCHESTRATOR=1 pnpm smoke
`);
}

const rootAbs = process.cwd();
const args = process.argv.slice(2);
const wantsList = args.includes('--list');
const wantsHelp = args.includes('--help') || args.includes('-h');

if (wantsHelp) {
  printHelp();
  process.exit(0);
}

const plan = await buildSmokePlan(rootAbs);

if (wantsList) {
  if (!plan.length) {
    out('No smoke tests found (expected *smoke*.test.ts).');
    process.exit(0);
  }

  out('Smoke tests discovered:');
  for (const t of plan) {
    const rel = path.relative(rootAbs, t.filePathAbs);
    out(`- ${t.id}`);
    out(`  flag: ${t.flag}=1`);
    out(`  pkg:  ${t.packageName}`);
    out(`  file: ${rel}`);
  }
  process.exit(0);
}

if (!plan.length) {
  err('No smoke tests found (expected *smoke*.test.ts).');
  process.exit(2);
}

const selectedFlags = getSelectedFlags();
const selected = selectedFlags.size ? plan.filter((t) => selectedFlags.has(t.flag)) : plan;

if (!selected.length) {
  err(`No smoke tests matched selection flags: ${Array.from(selectedFlags).sort().join(', ')}`);
  process.exit(2);
}

out(`Running ${selected.length}/${plan.length} smoke test(s)...`);

let exitCode = 0;
for (const t of selected) {
  const rel = path.relative(rootAbs, t.filePathAbs);
  out(`\n=== SMOKE ${t.id} ===`);
  out(`pkg: ${t.packageName}`);
  out(`file: ${rel}`);

  // Use pnpm filter so workspace resolution + deps are correct.
  const code = await runCommand(
    'pnpm',
    ['--filter', t.packageName, 'exec', process.execPath, ...t.nodeArgs],
    t.packageRootAbs
  );

  if (code !== 0) {
    exitCode = code;
    break;
  }
}

process.exit(exitCode);
