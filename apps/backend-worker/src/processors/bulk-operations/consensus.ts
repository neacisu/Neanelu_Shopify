export type SourcedValue = Readonly<{
  value: unknown;
  sourceType: string;
  sourceId?: string;
  confidence: number; // 0..1
  timestamp: Date;
  sourceUrl?: string;
}>;

export type ResolvedValue = Readonly<{
  value: unknown;
  provenance: unknown;
  needsReview: boolean;
}>;

export type ApplyConsensusResult = Readonly<{
  resolved: Readonly<{ canonicalTitle: string; brand: string | null; gtin: string | null }>;
  needsReview: boolean;
}>;

const SOURCE_PRIORITY: Record<string, number> = {
  brand: 100,
  curated: 80,
  ai_extracted: 50,
  bulk_import: 40,
  webhook: 30,
  scraping: 20,
  manual: 10,
};

export function resolveConflict(field: string, values: readonly SourcedValue[]): ResolvedValue {
  const normalized = values
    .filter((v) => v.value !== null && v.value !== undefined)
    .map((v) => ({
      ...v,
      confidence: clamp01(v.confidence),
    }));

  if (normalized.length === 0) {
    return {
      value: null,
      provenance: {
        field,
        resolvedAt: new Date().toISOString(),
        source: null,
        confidence: 0,
        alternates: [],
      },
      needsReview: false,
    };
  }

  const sorted = [...normalized].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.sourceType] ?? 0;
    const pb = SOURCE_PRIORITY[b.sourceType] ?? 0;
    return pb - pa || b.confidence - a.confidence || b.timestamp.getTime() - a.timestamp.getTime();
  });

  const winner = sorted[0]!;
  const alternates = sorted.slice(1);

  const needsReview = alternates.some((alt) => {
    if (alt.confidence <= 0.7) return false;
    return stableJson(alt.value) !== stableJson(winner.value);
  });

  return {
    value: winner.value,
    provenance: {
      field,
      source: winner.sourceType,
      sourceId: winner.sourceId ?? null,
      confidence: winner.confidence,
      timestamp: winner.timestamp.toISOString(),
      resolvedAt: new Date().toISOString(),
      alternates: alternates.map((v) => ({
        value: v.value,
        source: v.sourceType,
        sourceId: v.sourceId ?? null,
        confidence: v.confidence,
        timestamp: v.timestamp.toISOString(),
      })),
    },
    needsReview,
  };
}

export async function applyConsensusToProdMaster(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  productId: string;
  incoming: Readonly<{ canonicalTitle: string; brand: string | null; gtin: string | null }>;
  incomingSource: Readonly<{
    sourceId: string;
    sourceType: string;
    confidence: number;
    timestamp: Date;
    sourceUrl?: string;
  }>;
}): Promise<ApplyConsensusResult> {
  const row = await loadProductWithCurrentSpecs({
    client: params.client,
    productId: params.productId,
  });
  if (!row) throw new Error('consensus_target_not_found');

  const existingProvenance = asObject(row.provenance) ?? {};
  const existingUpdatedAt = row.product_updated_at ? new Date(row.product_updated_at) : new Date(0);

  const fields = {
    canonicalTitle: {
      field: 'canonical_title',
      existingValue: row.canonical_title,
      incomingValue: params.incoming.canonicalTitle,
    },
    brand: {
      field: 'brand',
      existingValue: row.brand,
      incomingValue: params.incoming.brand,
    },
    gtin: {
      field: 'gtin',
      existingValue: row.gtin,
      incomingValue: params.incoming.gtin,
    },
  } as const;

  const resolvedProvenance: Record<string, unknown> = { ...existingProvenance };
  let needsReview = false;

  const resolved: { canonicalTitle: string; brand: string | null; gtin: string | null } = {
    canonicalTitle: row.canonical_title,
    brand: row.brand,
    gtin: row.gtin,
  };

  for (const [key, meta] of Object.entries(fields) as [
    keyof typeof fields,
    (typeof fields)[keyof typeof fields],
  ][]) {
    const candidates: SourcedValue[] = [];

    if (meta.existingValue !== null && meta.existingValue !== undefined) {
      const prov = asObject(existingProvenance[meta.field]);
      const sourceId =
        typeof prov?.['sourceId'] === 'string'
          ? String(prov['sourceId'])
          : (row.primary_source_id ?? undefined);
      candidates.push({
        value: meta.existingValue,
        sourceType:
          typeof prov?.['source'] === 'string'
            ? String(prov['source'])
            : (row.primary_source_type ?? 'manual'),
        confidence: typeof prov?.['confidence'] === 'number' ? Number(prov['confidence']) : 0.7,
        timestamp:
          typeof prov?.['timestamp'] === 'string'
            ? new Date(String(prov['timestamp']))
            : existingUpdatedAt,
        ...(sourceId ? { sourceId } : {}),
      });
    }

    if (meta.incomingValue !== null && meta.incomingValue !== undefined) {
      candidates.push({
        value: meta.incomingValue,
        sourceType: params.incomingSource.sourceType,
        sourceId: params.incomingSource.sourceId,
        confidence: params.incomingSource.confidence,
        timestamp: params.incomingSource.timestamp,
        ...(params.incomingSource.sourceUrl ? { sourceUrl: params.incomingSource.sourceUrl } : {}),
      });
    }

    const r = resolveConflict(meta.field, candidates);
    resolvedProvenance[meta.field] = r.provenance;
    needsReview = needsReview || r.needsReview;

    const maybeString = asStringOrNull(r.value);
    if (key === 'canonicalTitle') resolved.canonicalTitle = maybeString ?? row.canonical_title;
    if (key === 'brand') resolved.brand = maybeString ?? row.brand;
    if (key === 'gtin') resolved.gtin = maybeString ?? row.gtin;
  }

  await params.client.query(
    `UPDATE prod_master
     SET
       canonical_title = $2,
       brand = $3,
       gtin = $4,
       needs_review = (needs_review OR $5),
       updated_at = now()
     WHERE id = $1`,
    [params.productId, resolved.canonicalTitle, resolved.brand, resolved.gtin, needsReview]
  );

  await upsertProdSpecsSnapshot({
    client: params.client,
    productId: params.productId,
    specs: {
      canonical_title: resolved.canonicalTitle,
      brand: resolved.brand,
      gtin: resolved.gtin,
    },
    provenance: resolvedProvenance,
    needsReview,
    reviewReason: needsReview ? 'consensus_conflict' : null,
  });

  return { resolved, needsReview };
}

type ProductWithSpecsRow = Readonly<{
  canonical_title: string;
  brand: string | null;
  gtin: string | null;
  primary_source_id: string | null;
  primary_source_type: string | null;
  product_updated_at: string | null;
  provenance: unknown;
  specs_id: string | null;
  specs_version: number | null;
}>;

async function loadProductWithCurrentSpecs(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  productId: string;
}): Promise<ProductWithSpecsRow | null> {
  const res = await params.client.query<ProductWithSpecsRow>(
    `SELECT
        pm.canonical_title,
        pm.brand,
        pm.gtin,
        pm.primary_source_id,
        ps.source_type AS primary_source_type,
        pm.updated_at::text AS product_updated_at,
        psn.provenance,
        psn.id::text AS specs_id,
        psn.version AS specs_version
     FROM prod_master pm
     LEFT JOIN prod_sources ps ON ps.id = pm.primary_source_id
     LEFT JOIN prod_specs_normalized psn
       ON psn.product_id = pm.id
      AND psn.is_current = true
     WHERE pm.id = $1
     LIMIT 1`,
    [params.productId]
  );
  return res.rows[0] ?? null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function upsertProdSpecsSnapshot(params: {
  client: {
    query: (
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: { id?: string; version?: number }[] }>;
  };
  productId: string;
  specs: unknown;
  provenance: unknown;
  needsReview: boolean;
  reviewReason: string | null;
}): Promise<void> {
  const current = await params.client.query(
    `SELECT id, version
     FROM prod_specs_normalized
     WHERE product_id = $1
       AND is_current = true
     LIMIT 1`,
    [params.productId]
  );

  const currentId = current.rows[0]?.id ?? null;
  const currentVersion = Number(current.rows[0]?.version ?? 0);
  const nextVersion = currentVersion > 0 ? currentVersion + 1 : 1;

  if (currentId) {
    await params.client.query(
      `UPDATE prod_specs_normalized
       SET is_current = false, updated_at = now()
       WHERE id = $1`,
      [currentId]
    );
  }

  await params.client.query(
    `INSERT INTO prod_specs_normalized (
       product_id,
       specs,
       raw_specs,
       provenance,
       version,
       is_current,
       needs_review,
       review_reason,
       created_at,
       updated_at
     )
     VALUES ($1, $2::jsonb, NULL, $3::jsonb, $4, true, $5, $6, now(), now())`,
    [
      params.productId,
      JSON.stringify(params.specs ?? {}),
      JSON.stringify(params.provenance ?? {}),
      nextVersion,
      params.needsReview,
      params.reviewReason,
    ]
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(sortKeysDeep(value));
  } catch {
    return String(value);
  }
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeysDeep(obj[key]);
    }
    return out;
  }
  return value;
}
