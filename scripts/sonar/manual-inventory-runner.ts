import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

type ScanStatus = 'pending' | 'in_progress' | 'analyzed' | 'skipped' | 'failed';

interface InventoryIssue {
  ruleId?: string;
  severity?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
}

interface ClaimResponse {
  ok: boolean;
  file: string | null;
  workerId: string;
  token: string | null;
  remainingPending: number;
}

interface CliOptions {
  output: string;
  worker: string;
  leaseSeconds: number;
  maxFiles: number;
  analyzerCommand?: string;
  dryRun: boolean;
  continueOnError: boolean;
}

interface AnalyzerResult {
  status: Extract<ScanStatus, 'analyzed' | 'skipped' | 'failed'>;
  issues: InventoryIssue[];
  error?: string;
  detail?: string;
}

const workspaceRoot = process.cwd();
const workerScript = path.join(workspaceRoot, 'scripts', 'sonar', 'manual-inventory-worker.ts');
const defaultOutput = path.join(workspaceRoot, 'temp', 'sonar-manual-inventory.json');

await main();

async function main(): Promise<void> {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = parseOptions(args);

    switch (command) {
      case 'run':
        await runLoop(options);
        break;
      case 'run-one':
        await runOne(options);
        break;
      default:
        printUsage();
        process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown runner error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    output: defaultOutput,
    worker: `runner-${process.pid}`,
    leaseSeconds: 300,
    maxFiles: 1,
    dryRun: false,
    continueOnError: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    switch (arg) {
      case '--':
        break;
      case '--output':
        options.output = resolvePath(value, '--output');
        index += 1;
        break;
      case '--worker':
        options.worker = requireValue(value, '--worker');
        index += 1;
        break;
      case '--lease-seconds':
        options.leaseSeconds = requirePositiveInt(value, '--lease-seconds');
        index += 1;
        break;
      case '--max-files':
        options.maxFiles = requirePositiveInt(value, '--max-files');
        index += 1;
        break;
      case '--analyzer-command':
        options.analyzerCommand = requireValue(value, '--analyzer-command');
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--continue-on-error':
        options.continueOnError = true;
        break;
      default:
        throw new TypeError(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage(): void {
  process.stdout.write(`Usage:
  node --import tsx scripts/sonar/manual-inventory-runner.ts run --worker runner-01 --max-files 20 --analyzer-command "node scripts/sonar/my-analyzer.js --file {file} --issues {issuesFile}"
  node --import tsx scripts/sonar/manual-inventory-runner.ts run-one --worker runner-01 --analyzer-command "node scripts/sonar/my-analyzer.js --file {file} --issues {issuesFile}"

Template placeholders:
  {file} absolute file path
  {relativeFile} workspace-relative file path
  {issuesFile} writable JSON output path
  {workspaceRoot} workspace root
  {inventoryFile} inventory JSON path
`);
}

async function runLoop(options: CliOptions): Promise<void> {
  const processed: string[] = [];

  for (let index = 0; index < options.maxFiles; index += 1) {
    const result = await processNextFile(options);
    if (result == null) {
      break;
    }

    processed.push(result);
  }

  printJson({
    ok: true,
    worker: options.worker,
    processed,
    processedCount: processed.length,
  });
}

async function runOne(options: CliOptions): Promise<void> {
  const result = await processNextFile(options);
  printJson({
    ok: true,
    worker: options.worker,
    processed: result == null ? [] : [result],
    processedCount: result == null ? 0 : 1,
  });
}

async function processNextFile(options: CliOptions): Promise<string | null> {
  const claim = await claimFile(options);

  if (!claim.ok) {
    throw new Error('Worker claim failed');
  }

  if (claim.file == null || claim.token == null) {
    return null;
  }

  if (options.dryRun) {
    await releaseFile(options, claim.file, claim.token, 'dry-run release');
    return claim.file;
  }

  try {
    const analysis = await analyzeFile(options, claim.file);
    await finalizeFile(options, claim.file, claim.token, analysis);
    return claim.file;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown analyzer failure';
    await failFile(options, claim.file, claim.token, message);

    if (!options.continueOnError) {
      throw error;
    }

    return claim.file;
  }
}

async function analyzeFile(options: CliOptions, relativeFile: string): Promise<AnalyzerResult> {
  if (options.analyzerCommand == null) {
    return {
      status: 'skipped',
      issues: [],
      detail: 'No analyzer command configured',
    };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sonar-manual-runner-'));
  const issuesFile = path.join(tempDir, 'issues.json');
  const absoluteFile = path.join(workspaceRoot, relativeFile);

  try {
    const command = interpolateCommand(options.analyzerCommand, {
      file: shellEscape(absoluteFile),
      relativeFile: shellEscape(relativeFile),
      issuesFile: shellEscape(issuesFile),
      workspaceRoot: shellEscape(workspaceRoot),
      inventoryFile: shellEscape(options.output),
    });

    await execShell(command, workspaceRoot);

    const exists = await safeReadFile(issuesFile);
    if (exists == null) {
      return {
        status: 'analyzed',
        issues: [],
      };
    }

    const parsed = JSON.parse(exists) as unknown;
    const issues = normalizeIssuesPayload(parsed);

    return {
      status: 'analyzed',
      issues,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function claimFile(options: CliOptions): Promise<ClaimResponse> {
  const output = await execNodeWorker([
    'claim',
    '--output',
    options.output,
    '--worker',
    options.worker,
    '--lease-seconds',
    String(options.leaseSeconds),
  ]);

  return JSON.parse(output) as ClaimResponse;
}

async function finalizeFile(
  options: CliOptions,
  file: string,
  token: string,
  result: AnalyzerResult
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sonar-manual-finalize-'));
  const issuesFile = path.join(tempDir, 'issues.json');

  try {
    await writeFile(issuesFile, `${JSON.stringify(result.issues, null, 2)}\n`, 'utf8');

    if (result.status === 'analyzed') {
      await execNodeWorker([
        'complete',
        '--output',
        options.output,
        '--worker',
        options.worker,
        '--file',
        file,
        '--token',
        token,
        '--issues-file',
        issuesFile,
      ]);
      return;
    }

    if (result.status === 'skipped') {
      await execNodeWorker([
        'skip',
        '--output',
        options.output,
        '--worker',
        options.worker,
        '--file',
        file,
        '--token',
        token,
        '--detail',
        result.detail ?? 'Skipped by analyzer',
      ]);
      return;
    }

    await execNodeWorker([
      'fail',
      '--output',
      options.output,
      '--worker',
      options.worker,
      '--file',
      file,
      '--token',
      token,
      '--error',
      result.error ?? 'Analyzer returned failed status',
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function failFile(
  options: CliOptions,
  file: string,
  token: string,
  error: string
): Promise<void> {
  await execNodeWorker([
    'fail',
    '--output',
    options.output,
    '--worker',
    options.worker,
    '--file',
    file,
    '--token',
    token,
    '--error',
    error,
  ]);
}

async function releaseFile(
  options: CliOptions,
  file: string,
  token: string,
  detail: string
): Promise<void> {
  await execNodeWorker([
    'release',
    '--output',
    options.output,
    '--worker',
    options.worker,
    '--file',
    file,
    '--token',
    token,
    '--detail',
    detail,
  ]);
}

async function execNodeWorker(args: string[]): Promise<string> {
  return await execProcess('node', ['--import', 'tsx', workerScript, ...args], workspaceRoot);
}

async function execShell(command: string, cwd: string): Promise<string> {
  return await execProcess('/bin/bash', ['-lc', command], cwd);
}

async function execProcess(command: string, args: string[], cwd: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
    });
  });
}

function interpolateCommand(template: string, values: Record<string, string>): string {
  let interpolated = template;

  for (const [key, value] of Object.entries(values)) {
    interpolated = interpolated.replaceAll(`{${key}}`, value);
  }

  return interpolated;
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function normalizeIssuesPayload(parsed: unknown): InventoryIssue[] {
  let items: unknown[] = [];

  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed != null && typeof parsed === 'object') {
    const record = parsed as { issues?: unknown[] };
    if (Array.isArray(record.issues)) {
      items = record.issues;
    }
  }

  return items.map((issue) => normalizeIssue(issue));
}

function normalizeIssue(issue: unknown): InventoryIssue {
  if (issue == null || typeof issue !== 'object') {
    throw new TypeError('Analyzer issue must be an object');
  }

  const candidate = issue as Record<string, unknown>;
  const normalized: InventoryIssue = {
    message: requireIssueMessage(candidate['message']),
  };

  const ruleId = optionalString(candidate['ruleId'] ?? candidate['rule']);
  const severity = optionalString(candidate['severity']);
  const line = optionalNumber(candidate['line']);
  const column = optionalNumber(candidate['column']);
  const endLine = optionalNumber(candidate['endLine']);
  const endColumn = optionalNumber(candidate['endColumn']);

  if (ruleId != null) normalized.ruleId = ruleId;
  if (severity != null) normalized.severity = severity;
  if (line != null) normalized.line = line;
  if (column != null) normalized.column = column;
  if (endLine != null) normalized.endLine = endLine;
  if (endColumn != null) normalized.endColumn = endColumn;

  return normalized;
}

function requireIssueMessage(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Analyzer issue must contain a non-empty message');
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolvePath(value: string | undefined, flag: string): string {
  const required = requireValue(value, flag);
  return path.isAbsolute(required) ? required : path.join(workspaceRoot, required);
}

function requireValue(value: string | undefined, flag: string): string {
  if (value == null || value.trim() === '') {
    throw new TypeError(`Missing value for ${flag}`);
  }

  return value.trim();
}

function requirePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(requireValue(value, flag), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${flag} must be a positive integer`);
  }

  return parsed;
}

function shellEscape(value: string): string {
  const escaped = value.replaceAll("'", "'\"'\"'");
  return "'" + escaped + "'";
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
