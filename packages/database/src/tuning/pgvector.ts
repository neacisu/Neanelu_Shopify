import type { PoolClient } from 'pg';

const MIN_EF_SEARCH = 40;
const MAX_EF_SEARCH = 200;

export const HNSW_M = 32;
export const HNSW_EF_CONSTRUCTION = 128;

export function getOptimalEfSearch(resultLimit: number): number {
  const fallback = MIN_EF_SEARCH;
  if (!Number.isFinite(resultLimit) || resultLimit <= 0) return fallback;
  const computed = Math.round(resultLimit * 2);
  return Math.min(MAX_EF_SEARCH, Math.max(MIN_EF_SEARCH, computed));
}

export async function setHnswEfSearch(client: PoolClient, efSearch: number): Promise<void> {
  const value = Math.floor(efSearch);
  const bounded = Math.min(MAX_EF_SEARCH, Math.max(MIN_EF_SEARCH, value));
  await client.query(`SET LOCAL hnsw.ef_search = ${bounded}`);
}

export async function withOptimizedSearch<T>(
  client: PoolClient,
  efSearch: number,
  fn: () => Promise<T>
): Promise<T> {
  await setHnswEfSearch(client, efSearch);
  return fn();
}
