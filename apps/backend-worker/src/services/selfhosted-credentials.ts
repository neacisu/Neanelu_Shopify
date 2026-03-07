import { decryptAesGcm, withTenantContext } from '@app/database';
import type { SelfHostedEndpoint } from '@app/types';
import { isIP } from 'node:net';

export type SelfHostedCredentials = Readonly<{
  enabled: boolean;
  bearerToken: string | null;
  endpoints: SelfHostedEndpoint[];
  connectionStatus: string | null;
}>;

type SelfHostedRow = Readonly<{
  selfhosted_enabled: boolean;
  selfhosted_bearer_token_ciphertext: Buffer | null;
  selfhosted_bearer_token_iv: Buffer | null;
  selfhosted_bearer_token_tag: Buffer | null;
  selfhosted_endpoints: unknown;
  selfhosted_connection_status: string | null;
}>;

function buildEncryptionKey(encryptionKeyHex: string): Buffer {
  const key = Buffer.from(encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

function isPrivateIpv4(hostname: string): boolean {
  if (isIP(hostname) !== 4) return false;
  if (hostname.startsWith('10.')) return true;
  if (hostname.startsWith('192.168.')) return true;
  const parts = hostname.split('.').map((part) => Number(part));
  return (
    parts.length === 4 &&
    parts[0] !== undefined &&
    parts[1] !== undefined &&
    parts[0] === 172 &&
    parts[1] >= 16 &&
    parts[1] <= 31
  );
}

export function validateSelfHostedBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid endpoint URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https endpoints are allowed');
  }

  if (!isPrivateIpv4(parsed.hostname)) {
    throw new Error('Self-hosted endpoint URL must use an RFC1918 IPv4 address');
  }

  return parsed.toString().replace(/\/$/, '');
}

function normalizeEndpoint(value: unknown, index: number): SelfHostedEndpoint {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid selfhosted endpoint at index ${index}`);
  }

  const record = value as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'].trim() : '';
  const label = typeof record['label'] === 'string' ? record['label'].trim() : '';
  const baseUrlRaw = typeof record['baseUrl'] === 'string' ? record['baseUrl'].trim() : '';
  const modelId = typeof record['modelId'] === 'string' ? record['modelId'].trim() : '';
  const type = record['type'];
  const enabled = record['enabled'] !== false;
  const maxConcurrentRequests = Number(record['maxConcurrentRequests'] ?? 1);
  const timeoutMs = Number(record['timeoutMs'] ?? 20_000);

  if (!id) throw new Error(`Missing selfhosted endpoint id at index ${index}`);
  if (!label) throw new Error(`Missing selfhosted endpoint label at index ${index}`);
  if (!baseUrlRaw) throw new Error(`Missing selfhosted endpoint baseUrl at index ${index}`);
  if (!modelId) throw new Error(`Missing selfhosted endpoint modelId at index ${index}`);
  if (type !== 'chat' && type !== 'embedding' && type !== 'both') {
    throw new Error(`Invalid selfhosted endpoint type at index ${index}`);
  }
  if (
    !Number.isInteger(maxConcurrentRequests) ||
    maxConcurrentRequests < 1 ||
    maxConcurrentRequests > 32
  ) {
    throw new Error(`Invalid maxConcurrentRequests at index ${index}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error(`Invalid timeoutMs at index ${index}`);
  }

  return {
    id,
    label,
    baseUrl: validateSelfHostedBaseUrl(baseUrlRaw),
    modelId,
    type,
    enabled,
    maxConcurrentRequests,
    timeoutMs,
  };
}

export function normalizeSelfHostedEndpoints(value: unknown): SelfHostedEndpoint[] {
  if (!Array.isArray(value)) return [];
  return value.map((endpoint, index) => normalizeEndpoint(endpoint, index));
}

export async function loadSelfHostedCredentials(params: {
  shopId: string;
  encryptionKeyHex: string;
  allowDisabled?: boolean;
}): Promise<SelfHostedCredentials | null> {
  const row = await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<SelfHostedRow>(
      `SELECT
         selfhosted_enabled,
         selfhosted_bearer_token_ciphertext,
         selfhosted_bearer_token_iv,
         selfhosted_bearer_token_tag,
         selfhosted_endpoints,
         selfhosted_connection_status
       FROM shop_ai_credentials
       WHERE shop_id = $1`,
      [params.shopId]
    );
    return result.rows[0];
  });

  if (!row) return null;
  if (!row.selfhosted_enabled && !params.allowDisabled) return null;

  let bearerToken: string | null = null;
  if (
    row.selfhosted_bearer_token_ciphertext &&
    row.selfhosted_bearer_token_iv &&
    row.selfhosted_bearer_token_tag
  ) {
    bearerToken = decryptAesGcm(
      row.selfhosted_bearer_token_ciphertext,
      buildEncryptionKey(params.encryptionKeyHex),
      row.selfhosted_bearer_token_iv,
      row.selfhosted_bearer_token_tag
    ).toString('utf-8');
  }

  return {
    enabled: row.selfhosted_enabled,
    bearerToken,
    endpoints: normalizeSelfHostedEndpoints(row.selfhosted_endpoints),
    connectionStatus: row.selfhosted_connection_status,
  };
}
