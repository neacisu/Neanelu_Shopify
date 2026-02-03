import { getDbPool } from '../db.js';
import { createHash } from 'crypto';

type StoreRawHarvestParams = Readonly<{
  sourceUrl: string;
  rawJson: unknown;
  rawHtml?: string;
}>;

export async function storeRawHarvest(params: StoreRawHarvestParams): Promise<string> {
  const pool = getDbPool();
  const sourceId = await getSerperSourceId(pool);
  const contentHash = createHash('sha256').update(JSON.stringify(params.rawJson)).digest('hex');

  const existing = await pool.query<{ id: string }>(
    `SELECT id
       FROM prod_raw_harvest
      WHERE content_hash = $1
      LIMIT 1`,
    [contentHash]
  );
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO prod_raw_harvest (
       source_id,
       source_url,
       raw_json,
       raw_html,
       http_status,
       processing_status,
       content_hash,
       fetched_at,
       created_at
     )
     VALUES ($1, $2, $3, $4, 200, 'pending', $5, now(), now())
     RETURNING id`,
    [sourceId, params.sourceUrl, params.rawJson, params.rawHtml ?? null, contentHash]
  );

  const insertedId = inserted.rows[0]?.id;
  if (!insertedId) {
    throw new Error('Failed to insert prod_raw_harvest row.');
  }
  return insertedId;
}

async function getSerperSourceId(pool: ReturnType<typeof getDbPool>): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT id
       FROM prod_sources
      WHERE name = 'serper-api'
      LIMIT 1`
  );
  if (!result.rows[0]?.id) {
    throw new Error('Serper source not found in prod_sources.');
  }
  return result.rows[0].id;
}
