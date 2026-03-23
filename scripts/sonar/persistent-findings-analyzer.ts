import { ESLint } from 'eslint';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

interface NormalizedFinding {
  path: string;
  source: string;
  engine: string;
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

interface CliOptions {
  file: string;
  issues: string;
  workspaceRoot: string;
}

interface SecretDetector {
  name: string;
  severity: 'warning' | 'error';
  regex: RegExp;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const analyzerScriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(scriptDirectory, '..', '..');
const tsconfigPath = path.join(defaultWorkspaceRoot, 'tsconfig.eslint.json');
const markdownlintConfigPath = path.join(defaultWorkspaceRoot, '.markdownlint.json');
const parsedTsconfigCache = new Map<string, ts.ParsedCommandLine | null>();
interface MarkdownlintOptions {
  files: string[];
  config?: Record<string, unknown>;
}

let markdownlintPromiseLoader:
  | ((options: MarkdownlintOptions) => Promise<Record<string, unknown>>)
  | null = null;
let markdownlintConfigCache: Record<string, unknown> | null | undefined;
const placeholderTokens = [
  '${',
  '<secret',
  '<token',
  'changeme',
  'dummy',
  'example',
  'localhost',
  'placeholder',
  'sample',
  'test_',
  'your-',
  'your_',
  'yourkey',
];
const credentialAssignmentPattern = /[:=]\s*["']([^"'\n]{8,})["']/;
const secretDetectors: SecretDetector[] = [
  {
    name: 'private key material',
    severity: 'error',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    name: 'GitHub personal access token',
    severity: 'error',
    regex: /\bgh[pousr]_\w{30,}\b/g,
  },
  {
    name: 'GitHub fine-grained token',
    severity: 'error',
    regex: /\bgithub_pat_\w{20,}\b/g,
  },
  {
    name: 'Slack token',
    severity: 'error',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    name: 'Google API key',
    severity: 'error',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    name: 'hardcoded credential-like assignment',
    severity: 'warning',
    regex:
      /\b(?:OPENAI_API_KEY|OPENROUTER_API_KEY|SHOPIFY_API_KEY|SHOPIFY_API_SECRET|BULLMQ_PRO_TOKEN|NPM_TASKFORCESH_TOKEN|ENCRYPTION_KEY_256|DATABASE_URL|REDIS_URL|POSTGRES_URL|XAI_API_KEY)\b\s*[:=]\s*["'][^"'\n]{8,}["']/g,
  },
  {
    name: 'authorization header token literal',
    severity: 'warning',
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/g,
  },
];

await main();

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const findings = await analyzeFile(options);
  await writeFile(options.issues, `${JSON.stringify(findings, null, 2)}\n`, 'utf8');
}

function parseOptions(args: string[]): CliOptions {
  let file: string | undefined;
  let issues: string | undefined;
  let root = defaultWorkspaceRoot;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    switch (arg) {
      case '--':
        break;
      case '--file':
        file = requireValue(value, '--file');
        index += 1;
        break;
      case '--issues':
        issues = requireValue(value, '--issues');
        index += 1;
        break;
      case '--workspace-root':
        root = requireValue(value, '--workspace-root');
        index += 1;
        break;
      default:
        throw new TypeError(`Unknown argument: ${arg}`);
    }
  }

  return {
    file: path.isAbsolute(requireValue(file, '--file'))
      ? requireValue(file, '--file')
      : path.join(root, requireValue(file, '--file')),
    issues: path.isAbsolute(requireValue(issues, '--issues'))
      ? requireValue(issues, '--issues')
      : path.join(root, requireValue(issues, '--issues')),
    workspaceRoot: root,
  };
}

async function analyzeFile(options: CliOptions): Promise<NormalizedFinding[]> {
  const relativePath = normalizePath(path.relative(options.workspaceRoot, options.file));
  const extension = path.extname(relativePath).toLowerCase();

  const findings = [
    ...(await collectLanguageFindings(relativePath, options.workspaceRoot, extension)),
    ...(await collectSecretFindings(relativePath, options.file)),
  ];

  return dedupeFindings(findings);
}

async function collectLanguageFindings(
  relativePath: string,
  root: string,
  extension: string
): Promise<NormalizedFinding[]> {
  if (isTypeScriptFamily(extension)) {
    return [
      ...collectTypeScriptDiagnostics(relativePath, root),
      ...(await collectEslintDiagnostics(relativePath, root)),
    ];
  }

  if (isJavaScriptFamily(extension)) {
    return await collectEslintDiagnostics(relativePath, root);
  }

  if (extension === '.json') {
    return await collectJsonDiagnostics(relativePath, root);
  }

  if (extension === '.yaml' || extension === '.yml') {
    return await collectYamlDiagnostics(relativePath, root);
  }

  if (extension === '.md') {
    return await collectMarkdownDiagnostics(relativePath, root);
  }

  return [];
}

function isTypeScriptFamily(extension: string): boolean {
  return extension === '.ts' || extension === '.tsx';
}

function isJavaScriptFamily(extension: string): boolean {
  return (
    extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs'
  );
}

function collectTypeScriptDiagnostics(relativePath: string, root: string): NormalizedFinding[] {
  const absolutePath = path.join(root, relativePath);
  const selectedTsconfigPath = selectTypeScriptProjectForFile(absolutePath);
  const parsedConfig = getParsedTsconfig(selectedTsconfigPath);

  if (parsedConfig == null) {
    return [];
  }

  const programOptions: ts.CreateProgramOptions = {
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
  };

  if (parsedConfig.projectReferences != null) {
    programOptions.projectReferences = parsedConfig.projectReferences;
  }

  const program = ts.createProgram(programOptions);

  const sourceFile = program.getSourceFile(absolutePath);
  if (sourceFile == null) {
    return [];
  }

  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];

  return diagnostics.map((diagnostic) => normalizeTypeScriptDiagnostic(diagnostic, relativePath));
}

function selectTypeScriptProjectForFile(absolutePath: string): string {
  const fileExists = (candidatePath: string): boolean => {
    return Boolean(ts.sys.fileExists(candidatePath));
  };
  const nearestProjectConfig = ts.findConfigFile(
    path.dirname(absolutePath),
    fileExists,
    'tsconfig.json'
  );

  if (nearestProjectConfig != null) {
    const parsedNearest = getParsedTsconfig(nearestProjectConfig);
    if (parsedNearest?.fileNames.includes(absolutePath)) {
      return nearestProjectConfig;
    }
  }

  return tsconfigPath;
}

function getParsedTsconfig(configPath: string): ts.ParsedCommandLine | null {
  const cached = parsedTsconfigCache.get(configPath);
  if (cached !== undefined) {
    return cached;
  }

  const parsedConfig = ts.getParsedCommandLineOfConfigFile(
    configPath,
    { noEmit: true },
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => undefined,
    }
  );

  parsedTsconfigCache.set(configPath, parsedConfig ?? null);
  return parsedConfig ?? null;
}

function normalizeTypeScriptDiagnostic(
  diagnostic: ts.Diagnostic,
  relativePath: string
): NormalizedFinding {
  const flattened = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const sourceFile = diagnostic.file;
  const position =
    sourceFile != null && diagnostic.start != null
      ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
  const endPosition =
    sourceFile != null && diagnostic.start != null && diagnostic.length != null
      ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start + diagnostic.length)
      : undefined;
  const line = position == null ? undefined : position.line + 1;
  const column = position == null ? undefined : position.character + 1;
  const endLine = endPosition == null ? undefined : endPosition.line + 1;
  const endColumn = endPosition == null ? undefined : endPosition.character + 1;

  return createFinding({
    path: relativePath,
    source: 'typescript',
    engine: 'tsc',
    owner: 'typescript',
    category: 'type-check',
    ...(typeof diagnostic.code === 'number'
      ? { code: `TS${diagnostic.code}`, ruleId: `TS${diagnostic.code}` }
      : {}),
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    ...(line == null ? {} : { line }),
    ...(column == null ? {} : { column }),
    ...(endLine == null ? {} : { endLine }),
    ...(endColumn == null ? {} : { endColumn }),
    message: flattened,
  });
}

async function collectEslintDiagnostics(
  relativePath: string,
  root: string
): Promise<NormalizedFinding[]> {
  const eslint = new ESLint({ cwd: root, warnIgnored: false });
  const [result] = await eslint.lintFiles([relativePath]);

  if (result == null) {
    return [];
  }

  return result.messages.map((message) =>
    createFinding({
      path: relativePath,
      source: 'eslint',
      engine: 'eslint',
      owner: 'eslint',
      category: message.fatal ? 'fatal' : 'lint',
      ...(message.ruleId == null ? {} : { ruleId: message.ruleId, code: message.ruleId }),
      severity: message.severity === 2 ? 'error' : 'warning',
      line: message.line,
      column: message.column,
      ...(message.endLine == null ? {} : { endLine: message.endLine }),
      ...(message.endColumn == null ? {} : { endColumn: message.endColumn }),
      message: message.message,
    })
  );
}

async function collectJsonDiagnostics(
  relativePath: string,
  root: string
): Promise<NormalizedFinding[]> {
  const absolutePath = path.join(root, relativePath);
  const content = await readFile(absolutePath, 'utf8');
  const fileName = path.basename(relativePath);

  try {
    if (
      fileName === 'tsconfig.json' ||
      fileName.startsWith('tsconfig.') ||
      fileName.endsWith('.jsonc')
    ) {
      const parsed = ts.parseConfigFileTextToJson(absolutePath, content);
      if (parsed.error != null) {
        throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
      }
      return [];
    }

    JSON.parse(content);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    return [
      createFinding({
        path: relativePath,
        source: 'json',
        engine: 'json-parse',
        owner: 'json',
        category: 'syntax',
        severity: 'error',
        message,
      }),
    ];
  }
}

async function collectYamlDiagnostics(
  relativePath: string,
  root: string
): Promise<NormalizedFinding[]> {
  const absolutePath = path.join(root, relativePath);
  const content = await readFile(absolutePath, 'utf8');
  const document = parseDocument(content);

  return document.errors.map((error) =>
    createFinding({
      path: relativePath,
      source: 'yaml',
      engine: 'yaml-parse',
      owner: 'yaml',
      category: 'syntax',
      severity: 'error',
      message: error.message,
    })
  );
}

async function collectMarkdownDiagnostics(
  relativePath: string,
  root: string
): Promise<NormalizedFinding[]> {
  const absolutePath = path.join(root, relativePath);
  const lintPromise = await getMarkdownlintPromise();
  const markdownlintConfig = await getMarkdownlintConfig();
  const lintOptions: MarkdownlintOptions = {
    files: [absolutePath],
  };

  if (markdownlintConfig != null) {
    lintOptions.config = markdownlintConfig;
  }

  const result = await lintPromise(lintOptions);
  const issues = (result[absolutePath] ?? []) as {
    ruleNames: string[];
    lineNumber: number;
    errorRange?: number[];
    ruleDescription: string;
    errorDetail?: string;
  }[];

  return issues.map((issue) =>
    createFinding({
      path: relativePath,
      source: 'markdownlint',
      engine: 'markdownlint',
      owner: 'markdownlint',
      category: 'lint',
      ...(issue.ruleNames[0] == null
        ? {}
        : { ruleId: issue.ruleNames[0], code: issue.ruleNames[0] }),
      severity: 'warning',
      line: issue.lineNumber,
      ...(issue.errorRange?.[0] == null ? {} : { column: issue.errorRange[0] }),
      message: issue.errorDetail
        ? `${issue.ruleDescription}: ${issue.errorDetail}`
        : issue.ruleDescription,
    })
  );
}

async function getMarkdownlintPromise(): Promise<
  (options: MarkdownlintOptions) => Promise<Record<string, unknown>>
> {
  if (markdownlintPromiseLoader != null) {
    return markdownlintPromiseLoader;
  }

  const modulePath = path.join(
    defaultWorkspaceRoot,
    'node_modules',
    'markdownlint',
    'lib',
    'markdownlint.mjs'
  );
  const moduleUrl = pathToFileURL(modulePath).href;
  const imported = (await import(moduleUrl)) as { lintPromise?: unknown };

  if (typeof imported.lintPromise !== 'function') {
    throw new TypeError('markdownlint lintPromise API is unavailable');
  }

  markdownlintPromiseLoader = imported.lintPromise as (
    options: MarkdownlintOptions
  ) => Promise<Record<string, unknown>>;
  return markdownlintPromiseLoader;
}

async function getMarkdownlintConfig(): Promise<Record<string, unknown> | null> {
  if (markdownlintConfigCache !== undefined) {
    return markdownlintConfigCache;
  }

  try {
    const rawConfig = await readFile(markdownlintConfigPath, 'utf8');
    const parsedConfig = JSON.parse(rawConfig) as Record<string, unknown>;
    markdownlintConfigCache = parsedConfig;
    return parsedConfig;
  } catch {
    markdownlintConfigCache = null;
    return null;
  }
}

async function collectSecretFindings(
  relativePath: string,
  absolutePath: string
): Promise<NormalizedFinding[]> {
  if (absolutePath === analyzerScriptPath) {
    return [];
  }

  const fileStats = await stat(absolutePath);
  if (!fileStats.isFile() || fileStats.size > 512 * 1024) {
    return [];
  }

  const content = await readFile(absolutePath, 'utf8');
  if (content.includes('\u0000')) {
    return [];
  }

  const findings: NormalizedFinding[] = [];

  for (const detector of secretDetectors) {
    detector.regex.lastIndex = 0;
    for (const match of content.matchAll(detector.regex)) {
      const matchedText = match[0] ?? '';
      if (shouldIgnoreSecretMatch(matchedText)) {
        continue;
      }

      const index = match.index ?? 0;
      const { line, column } = lineAndColumnFromIndex(content, index);
      findings.push(
        createFinding({
          path: relativePath,
          source: 'secret-scan',
          engine: 'secret-pattern-scan',
          owner: 'secret-scan',
          category: 'security',
          type: 'credential-exposure',
          ruleId: detector.name,
          code: detector.name,
          severity: detector.severity,
          line,
          column,
          evidence: matchedText.slice(0, 80),
          message: `Possible ${detector.name}.`,
        })
      );
    }
  }

  return findings;
}

function isProbablyPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return placeholderTokens.some((token) => normalized.includes(token));
}

function extractAssignedCredentialValue(matchedText: string): string | null {
  const assignmentMatch = credentialAssignmentPattern.exec(matchedText);
  return assignmentMatch?.[1] ?? null;
}

function isVariableBackedCredentialValue(value: string): boolean {
  if (!value.includes('$')) {
    return false;
  }

  const normalizedValue = value.replaceAll('$$', '$');
  const residualLiteral = normalizedValue
    .replaceAll(/\$(?:\{[^}\n]+\}|[A-Za-z_]\w*)/g, '')
    .replaceAll(/\b(?:postgres(?:ql)?|mysql|redis|amqps?|mongodb(?:\+srv)?|https?|wss?)\b/gi, '')
    .replaceAll(/[0-9:/@?&=+,%._-]+/g, '')
    .trim();

  return residualLiteral === '';
}

function shouldIgnoreSecretMatch(matchedText: string): boolean {
  if (isProbablyPlaceholder(matchedText)) {
    return true;
  }

  const assignedValue = extractAssignedCredentialValue(matchedText);
  return assignedValue != null && isVariableBackedCredentialValue(assignedValue);
}

function lineAndColumnFromIndex(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const lines = before.split('\n');
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return { line, column };
}

function dedupeFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const seen = new Set<string>();
  const deduped: NormalizedFinding[] = [];

  for (const finding of findings) {
    const key = [
      finding.path,
      finding.source,
      finding.ruleId ?? finding.code ?? '',
      String(finding.line ?? 0),
      String(finding.column ?? 0),
      finding.message,
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(finding);
  }

  return deduped;
}

function createFinding(
  finding: Pick<NormalizedFinding, 'path' | 'source' | 'engine' | 'message'> &
    Partial<Omit<NormalizedFinding, 'path' | 'source' | 'engine' | 'message'>>
): NormalizedFinding {
  const normalized: NormalizedFinding = {
    path: finding.path,
    source: finding.source,
    engine: finding.engine,
    message: finding.message,
  };

  if (finding.owner != null) normalized.owner = finding.owner;
  if (finding.category != null) normalized.category = finding.category;
  if (finding.type != null) normalized.type = finding.type;
  if (finding.ruleId != null) normalized.ruleId = finding.ruleId;
  if (finding.code != null) normalized.code = finding.code;
  if (finding.severity != null) normalized.severity = finding.severity;
  if (finding.line != null) normalized.line = finding.line;
  if (finding.column != null) normalized.column = finding.column;
  if (finding.endLine != null) normalized.endLine = finding.endLine;
  if (finding.endColumn != null) normalized.endColumn = finding.endColumn;
  if (finding.evidence != null) normalized.evidence = finding.evidence;

  return normalized;
}

function requireValue(value: string | undefined, flag: string): string {
  if (value == null || value.trim() === '') {
    throw new TypeError(`Missing value for ${flag}`);
  }

  return value.trim();
}

function normalizePath(targetPath: string): string {
  return targetPath.split(path.sep).join('/');
}
