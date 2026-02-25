/**
 * Credential Watcher — monitorizează fișierul de secrets renderizat de OpenBao
 * și rotește pool-ul DB automat la schimbarea credentialelor.
 *
 * Flux:
 * 1. OpenBao Agent renderizează /secrets/neanelu-api.env (cu DATABASE_URL nou)
 * 2. fs.watchFile detectează mtime modificat
 * 3. Se parsează DATABASE_URL din fișier
 * 4. Se apelează rotatePool() — swap atomic, drain graceful
 *
 * Dacă fișierul nu există la start, watcher-ul se dezactivează silențios
 * (permițând rularea locală fără OpenBao).
 */

import { readFile, stat } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';

import { rotatePool, getCurrentConnectionString } from './db.js';

const SECRETS_PATH = process.env['CREDENTIALS_FILE'] ?? '/secrets/neanelu-api.env';
const POLL_INTERVAL_MS = 5_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

let watching = false;
let lastMtimeMs = 0;

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>): void {
  const payload = { component: 'credential-watcher', ...extra };
  if (level === 'error') {
    console.error(`[CRED-WATCH] ${msg}`, payload);
  } else if (level === 'warn') {
    console.warn(`[CRED-WATCH] ${msg}`, payload);
  } else {
    console.info(`[CRED-WATCH] ${msg}`, payload);
  }
}

function parseDatabaseUrl(envContent: string): string | null {
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const eqIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIndex).trim();
    if (key !== 'DATABASE_URL') continue;

    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value || null;
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleChange(): Promise<void> {
  let content: string;
  try {
    content = await readFile(SECRETS_PATH, 'utf-8');
  } catch (err) {
    log('error', 'Failed to read credentials file', { path: SECRETS_PATH, error: String(err) });
    return;
  }

  const newUrl = parseDatabaseUrl(content);
  if (!newUrl) {
    log('warn', 'No DATABASE_URL found in credentials file');
    return;
  }

  const currentUrl = getCurrentConnectionString();
  if (newUrl === currentUrl) {
    log('info', 'DATABASE_URL unchanged, skipping rotation');
    return;
  }

  log('info', 'DATABASE_URL changed, rotating pool...');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await rotatePool(newUrl);
      log('info', 'Pool rotated successfully', { attempt });
      return;
    } catch (err) {
      log('error', `Pool rotation attempt ${attempt}/${MAX_RETRIES} failed`, {
        error: String(err),
      });
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  log('error', 'All pool rotation attempts exhausted — pool NOT rotated');
}

/**
 * Pornește watcher-ul de credentiale.
 * Dacă fișierul nu există, se dezactivează silențios (dev local fără OpenBao).
 */
export async function startCredentialWatcher(): Promise<void> {
  if (watching) {
    log('warn', 'Watcher already running');
    return;
  }

  try {
    const s = await stat(SECRETS_PATH);
    lastMtimeMs = s.mtimeMs;
  } catch {
    log('info', 'Credentials file not found, watcher disabled (local dev mode)', {
      path: SECRETS_PATH,
    });
    return;
  }

  log('info', 'Starting credential file watcher', { path: SECRETS_PATH, pollMs: POLL_INTERVAL_MS });

  watchFile(SECRETS_PATH, { interval: POLL_INTERVAL_MS }, (curr) => {
    if (curr.mtimeMs <= lastMtimeMs) return;
    lastMtimeMs = curr.mtimeMs;
    void handleChange();
  });

  watching = true;
}

/**
 * Oprește watcher-ul de credentiale.
 */
export function stopCredentialWatcher(): void {
  if (!watching) return;
  unwatchFile(SECRETS_PATH);
  watching = false;
  log('info', 'Credential watcher stopped');
}
