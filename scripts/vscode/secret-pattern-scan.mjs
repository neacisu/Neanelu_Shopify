import { readdir, readFile, stat } from 'node:fs/promises';
import { cwd, exit } from 'node:process';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = cwd();
const scannerScriptPath = fileURLToPath(import.meta.url);
const maxFileSizeBytes = 512 * 1024;
const excludedDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);
const allowedExtensions = new Set([
  '',
  '.cjs',
  '.conf',
  '.cts',
  '.env',
  '.ini',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.mts',
  '.properties',
  '.sh',
  '.sql',
  '.text',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
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
const detectors = [
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

async function* walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        yield* walk(absolutePath);
      }
      continue;
    }
    yield absolutePath;
  }
}

function isProbablyPlaceholder(value) {
  const normalized = value.toLowerCase();
  return placeholderTokens.some((token) => normalized.includes(token));
}

function extractAssignedCredentialValue(matchedText) {
  const assignmentMatch = credentialAssignmentPattern.exec(matchedText);
  return assignmentMatch?.[1] ?? null;
}

function isVariableBackedCredentialValue(value) {
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

function shouldIgnoreSecretMatch(matchedText) {
  if (isProbablyPlaceholder(matchedText)) {
    return true;
  }

  const assignedValue = extractAssignedCredentialValue(matchedText);
  return assignedValue != null && isVariableBackedCredentialValue(assignedValue);
}

function lineAndColumnFromIndex(content, index) {
  const before = content.slice(0, index);
  const lines = before.split('\n');
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return { line, column };
}

let findingCount = 0;

for await (const filePath of walk(workspaceRoot)) {
  if (resolve(filePath) === scannerScriptPath) {
    continue;
  }

  const fileName = filePath.split('/').at(-1) ?? '';
  const extension = extname(filePath);
  if (!allowedExtensions.has(extension) && !fileName.startsWith('.env')) {
    continue;
  }

  const fileStats = await stat(filePath).catch(() => null);
  if (fileStats === null) {
    continue;
  }
  if (fileStats.size > maxFileSizeBytes) {
    continue;
  }

  const content = await readFile(filePath, 'utf8').catch(() => null);
  if (content === null || content.includes('\u0000')) {
    continue;
  }

  for (const detector of detectors) {
    detector.regex.lastIndex = 0;
    for (const match of content.matchAll(detector.regex)) {
      const matchedText = match[0] ?? '';
      if (shouldIgnoreSecretMatch(matchedText)) {
        continue;
      }

      const index = match.index ?? 0;
      const { line, column } = lineAndColumnFromIndex(content, index);
      console.log(
        `${resolve(filePath)}:${line}:${column}: ${detector.severity}: [secret-scan] Possible ${detector.name}.`
      );
      findingCount += 1;
    }
  }
}

exit(findingCount > 0 ? 1 : 0);
