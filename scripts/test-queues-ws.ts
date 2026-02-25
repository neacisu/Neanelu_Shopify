/**
 * Test WebSocket /api/queues/ws: conectare și monitorizare mesaje 20s.
 *
 * Folosire (recomandat în dev): rulează cu secretele din OpenBao – tokenul este rezolvat automat din DB + SHOPIFY_API_SECRET:
 *   scripts/with-secrets.sh pnpm tsx scripts/test-queues-ws.ts
 *
 * Opțional:
 *   BASE_WS_URL=http://127.0.0.1:65101  (default: 65101 prin proxy web-admin)
 *   SESSION_TOKEN=...                    (dacă e setat, se folosește; altfel se generează din DB + secret)
 */

import { createHmac } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';

interface SessionData {
  shopId: string;
  shopDomain: string;
  createdAt: number;
}

interface QueueSnapshot {
  name: string;
  waiting: number;
  active: number;
  failed: number;
}

interface SnapshotPayload {
  queues?: QueueSnapshot[];
  initial?: boolean;
  error?: string;
  timestamp?: string;
}

interface WsMessage {
  event: string;
  data: SnapshotPayload;
}

const base = (process.env['BASE_WS_URL'] ?? 'http://127.0.0.1:65101').trim();
const wsScheme = base.startsWith('https') ? 'wss' : 'ws';
const u = new URL(base);

function createSessionToken(data: SessionData, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function resolveSessionToken(): Promise<string> {
  const explicit = (process.env['SESSION_TOKEN'] ?? '').trim();
  if (explicit) {
    return explicit;
  }

  const databaseUrl = process.env['DATABASE_URL'] ?? process.env['MIGRATION_DATABASE_URL'];
  const secret = (process.env['SHOPIFY_API_SECRET'] ?? '').trim();
  if (!databaseUrl || !secret) {
    console.error('Eroare: SESSION_TOKEN ne setat și (DATABASE_URL + SHOPIFY_API_SECRET) lipsesc.');
    console.error(
      'Rulează cu secretele dev: scripts/with-secrets.sh pnpm tsx scripts/test-queues-ws.ts'
    );
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const res = await pool.query<{ id: string; shopify_domain: string }>(
      'SELECT id, shopify_domain FROM shops ORDER BY created_at LIMIT 1'
    );
    const row = res.rows[0];
    if (!row) {
      console.error('Eroare: nu există niciun shop în DB. Conectează mai întâi magazinul Shopify.');
      process.exit(1);
    }
    const token = createSessionToken(
      { shopId: row.id, shopDomain: row.shopify_domain, createdAt: Date.now() },
      secret
    );
    console.info('Token sesiune generat din DB (shop:', row.shopify_domain, ')');
    return token;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const token = await resolveSessionToken();
  const path = `/api/queues/ws?token=${encodeURIComponent(token)}`;
  const uri = `${wsScheme}://${u.host}${path}`;

  console.info('Conectare la', uri, '...');

  const ws = new WebSocket(uri);
  let snapshotCount = 0;
  const start = Date.now();
  const timeout = 20_000;

  ws.on('open', () => {
    console.info('Conectat. Aștept mesaje 20s (refresh la ~0s și ~15s)...\n');
  });

  ws.on('message', (raw: WebSocket.RawData) => {
    const text = Buffer.isBuffer(raw)
      ? raw.toString('utf8')
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw).toString('utf8')
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : '';
    try {
      const obj = JSON.parse(text) as WsMessage;
      const evt = obj.event ?? '?';
      const payload = obj.data;
      if (evt === 'queues.snapshot') {
        snapshotCount++;
        const queues = payload.queues;
        const n = Array.isArray(queues) ? queues.length : 0;
        const initial = payload.initial === true;
        const err = payload.error;
        const ts = payload.timestamp ?? '';
        console.info(
          `\n[snapshot #${String(snapshotCount)}] initial=${String(initial)} queues=${String(n)} error=${JSON.stringify(err)} timestamp=${ts}`
        );
        if (!initial && Array.isArray(queues) && queues.length > 0) {
          for (const q of queues.slice(0, 3)) {
            console.info(
              `  - ${q.name}: w=${String(q.waiting)} a=${String(q.active)} f=${String(q.failed)}`
            );
          }
          if (queues.length > 3) {
            console.info(`  ... și încă ${String(queues.length - 3)} cozi`);
          }
        }
      } else {
        console.info(`\n[${evt}]`, JSON.stringify(payload).slice(0, 200));
      }
    } catch {
      console.info('\n[raw]', text.slice(0, 200));
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.info(
      `\n\nConexiune închisă: code=${String(code)} reason=${String(reason) || '(none)'} după ${elapsed}s.`
    );
    console.info(
      `Total snapshot-uri primite: ${String(snapshotCount)} (așteptat: >=2 – imediat + după ~15s)`
    );
    if (code === 1006) {
      console.info('(Code 1006 = conexiunea închisă anormal, de ex. 401 Unauthorized la upgrade.)');
    }
    if (snapshotCount === 0 && code !== 1000) {
      console.error(
        'Niciun snapshot – fie 401 (setează SESSION_TOKEN), fie proxy-ul nu transmite WebSocket (verifică ws: true în vite.config.ts și repornește web-admin).'
      );
      process.exit(1);
    }
  });

  ws.on('error', (err: Error) => {
    console.error('Eroare WebSocket:', err.message);
    process.exit(1);
  });

  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeout);
  });
  ws.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
