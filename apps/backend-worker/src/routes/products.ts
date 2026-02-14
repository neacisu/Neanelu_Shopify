import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { withTenantContext } from '@app/database';
import { normalizeGTIN } from '@app/pim';
import {
  createRedisConnection,
  enqueueBulkOrchestratorJob,
  enqueueEnrichmentJob,
} from '@app/queue-manager';
import { enqueueConsensusJob } from '../queue/consensus-queue.js';
import type { BulkOrchestratorJobPayload, EnrichmentJobPayload } from '@app/types';
import type { ProductDetail, ProductVariantDetail } from '@app/types';
import type { SessionConfig } from '../auth/session.js';
import { getSessionFromRequest, requireSession } from '../auth/session.js';

// Local type definitions to avoid ESLint resolution issues with path aliases in monorepo
type LocalSyncStatus = 'synced' | 'pending' | 'error' | 'never';
type LocalQualityLevel = 'bronze' | 'silver' | 'golden' | 'review_needed';

interface LocalProductPimData {
  masterId: string;
  taxonomyId: string | null;
  qualityLevel: LocalQualityLevel;
  qualityScore: number | null;
  qualityScoreBreakdown: {
    completeness: number;
    accuracy: number;
    consistency: number;
  } | null;
  titleMaster: string | null;
  descriptionMaster: string | null;
  descriptionShort: string | null;
  brand: string | null;
  manufacturer: string | null;
  gtin: string | null;
  mpn: string | null;
  needsReview: boolean;
  promotedToSilverAt: string | null;
  promotedToGoldenAt: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;

type ProductsRoutesOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type ExportJob = Readonly<{
  jobId: string;
  shopId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  downloadUrl?: string;
  format: 'csv' | 'json' | 'excel';
  error?: string;
  payload?: string;
  contentType?: string;
}>;

type ImportJob = Readonly<{
  jobId: string;
  shopId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  summary?: {
    total: number;
    valid: number;
    errors: number;
  };
  errors?: { row: number; message: string }[];
  previewRows?: {
    row: number;
    data: Record<string, string>;
    error?: string;
  }[];
}>;

const JOB_TTL_SECONDS = 60 * 60;

function getJobKey(prefix: string, jobId: string): string {
  return `products:${prefix}:${jobId}`;
}

async function setJob(
  redis: ReturnType<typeof createRedisConnection>,
  prefix: string,
  jobId: string,
  value: unknown
) {
  await redis.set(getJobKey(prefix, jobId), JSON.stringify(value), 'EX', JOB_TTL_SECONDS);
}

async function getJob<T>(
  redis: ReturnType<typeof createRedisConnection>,
  prefix: string,
  jobId: string
): Promise<T | null> {
  const raw = await redis.get(getJobKey(prefix, jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
  } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
    status,
  } as const;
}

function parseIntParam(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseArrayParam(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseProductIds(value: unknown): string[] {
  return Array.isArray(value) && value.length ? value.filter((id) => typeof id === 'string') : [];
}

function normalizeStatus(input: string | null): 'ACTIVE' | 'DRAFT' | 'ARCHIVED' | null {
  if (!input) return null;
  const normalized = input.toUpperCase();
  if (normalized === 'ACTIVE' || normalized === 'DRAFT' || normalized === 'ARCHIVED') {
    return normalized;
  }
  return null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 255);
}

type ProductListRow = Readonly<{
  id: string;
  title: string;
  vendor: string | null;
  status: string | null;
  productType: string | null;
  featuredImageUrl: string | null;
  categoryId: string | null;
  syncedAt: string | null;
  updatedAtShopify: string | null;
  variantsCount: number;
  syncStatus: LocalSyncStatus | null;
  qualityLevel: LocalQualityLevel | null;
  qualityScore: string | null;
}>;

type ProductDetailRow = Readonly<{
  id: string;
  title: string;
  handle: string;
  description: string | null;
  descriptionHtml: string | null;
  vendor: string | null;
  status: string | null;
  productType: string | null;
  tags: string[] | null;
  featuredImageUrl: string | null;
  categoryId: string | null;
  priceRange: { min: string; max: string; currency: string } | null;
  metafields: Record<string, unknown> | null;
  syncedAt: string | null;
  createdAtShopify: string | null;
  updatedAtShopify: string | null;
  pimMasterId: string | null;
  pimTaxonomyId: string | null;
  pimQualityLevel: LocalQualityLevel | null;
  pimQualityScore: string | null;
  pimQualityScoreBreakdown: Record<string, number> | null;
  pimBrand: string | null;
  pimManufacturer: string | null;
  pimGtin: string | null;
  pimMpn: string | null;
  pimNeedsReview: boolean | null;
  pimPromotedToSilverAt: string | null;
  pimPromotedToGoldenAt: string | null;
  pimTitleMaster: string | null;
  pimDescriptionMaster: string | null;
  pimDescriptionShort: string | null;
}>;

type ProductVariantRow = Readonly<{
  id: string;
  sku: string | null;
  title: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number;
  imageUrl: string | null;
  selectedOptions: { name: string; value: string }[];
}>;

type FilterConfig = Readonly<{
  search?: string | null;
  status?: string | null;
  vendor?: string[] | null;
  productType?: string[] | null;
  qualityLevel?: string[] | null;
  syncStatus?: string[] | null;
  categoryId?: string | null;
  enrichmentStatus?: string[] | null;
  hasGtin?: boolean | null;
}>;

function buildFilters(params: FilterConfig) {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value?: unknown) => {
    where.push(sql);
    if (typeof value !== 'undefined') values.push(value);
  };

  if (params.search) {
    add(
      `(to_tsvector('simple', coalesce(p.title, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(p.handle, '')) @@ plainto_tsquery('simple', $${values.length + 1})
        OR EXISTS (
          SELECT 1
          FROM shopify_variants sv
          WHERE sv.product_id = p.id
            AND sv.shop_id = p.shop_id
            AND sv.sku ILIKE $${values.length + 1}
        ))`,
      params.search
    );
  }

  if (params.status) {
    add(`p.status = $${values.length + 1}`, params.status);
  }

  if (params.vendor?.length) {
    add(`p.vendor = ANY($${values.length + 1}::text[])`, params.vendor);
  }

  if (params.productType?.length) {
    add(`p.product_type = ANY($${values.length + 1}::text[])`, params.productType);
  }

  if (params.categoryId) {
    add(`p.category_id = $${values.length + 1}`, params.categoryId);
  }

  if (params.qualityLevel?.length) {
    add(`pm.data_quality_level = ANY($${values.length + 1}::text[])`, params.qualityLevel);
  }

  if (params.syncStatus?.length) {
    add(`pcm.sync_status = ANY($${values.length + 1}::text[])`, params.syncStatus);
  }

  if (params.enrichmentStatus?.length) {
    add(
      `COALESCE(p.metafields->'app--neanelu--pim'->>'enrichment_status', p.metafields->>'enrichment_status') = ANY($${values.length + 1}::text[])`,
      params.enrichmentStatus
    );
  }

  if (params.hasGtin != null) {
    add(
      params.hasGtin
        ? `(pm.gtin IS NOT NULL AND pm.gtin <> '')`
        : `(pm.gtin IS NULL OR pm.gtin = '')`
    );
  }

  return { where, values };
}

function toCsv(rows: Record<string, unknown>[]): string {
  const header = Object.keys(rows[0] ?? {}).join(',');
  const csvRows = rows.map((row) =>
    Object.values(row)
      .map((value) => {
        if (value === null || value === undefined) return '""';
        if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        const stringValue =
          typeof value === 'string'
            ? value
            : typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : '';
        return `"${stringValue.replace(/"/g, '""')}"`;
      })
      .join(',')
  );
  return [header, ...csvRows].join('\n');
}

function toExcel(rows: Record<string, unknown>[]): string {
  const header = Object.keys(rows[0] ?? {});
  const formatCell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    return '';
  };
  const body = rows
    .map((row) => `<tr>${header.map((key) => `<td>${formatCell(row[key])}</td>`).join('')}</tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><table><thead><tr>${header
    .map((key) => `<th>${key}</th>`)
    .join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function parseCsvPayload(payload: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  const flushField = () => {
    current.push(field);
    field = '';
  };

  for (let i = 0; i < payload.length; i += 1) {
    const char = payload[i] ?? '';
    const next = payload[i + 1] ?? '';

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ',') {
      flushField();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      flushField();
      if (current.some((cell) => cell.length > 0)) {
        rows.push(current);
      }
      current = [];
      if (char === '\r' && next === '\n') i += 1;
      continue;
    }

    field += char;
  }

  if (field.length > 0 || current.length > 0) {
    flushField();
    rows.push(current);
  }

  if (rows.length === 0) return [];
  const headers = rows[0] ?? [];
  return rows.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header.trim()] = (cells[idx] ?? '').trim();
    });
    return row;
  });
}

export const productsRoutes: FastifyPluginAsync<ProductsRoutesOptions> = (
  server: FastifyInstance,
  opts
): Promise<void> => {
  const { logger, sessionConfig } = opts;
  const requireAdminSession = { preHandler: requireSession(sessionConfig) } as const;
  const redis = createRedisConnection({ redisUrl: opts.env.redisUrl });

  redis.on('error', (error: unknown) => {
    logger.warn({ error }, 'Redis error (products jobs)');
  });

  server.addHook('onClose', async () => {
    await redis.quit().catch(() => undefined);
  });

  server.get('/products', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const query = request.query as {
      page?: unknown;
      limit?: unknown;
      search?: unknown;
      status?: unknown;
      vendor?: unknown;
      productType?: unknown;
      qualityLevel?: unknown;
      syncStatus?: unknown;
      categoryId?: unknown;
      enrichmentStatus?: unknown;
      hasGtin?: unknown;
      sortBy?: unknown;
      sortOrder?: unknown;
    };

    const page = parseIntParam(query.page, 1, 1, 100000);
    const limit = parseIntParam(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const search = normalizeString(query.search);
    const status = normalizeStatus(normalizeString(query.status));
    const vendor = parseArrayParam(query.vendor);
    const productType = parseArrayParam(query.productType);
    const qualityLevel = parseArrayParam(query.qualityLevel);
    const syncStatus = parseArrayParam(query.syncStatus);
    const categoryId = normalizeString(query.categoryId);
    const enrichmentStatus = parseArrayParam(query.enrichmentStatus);
    const hasGtin =
      typeof query.hasGtin === 'string'
        ? query.hasGtin === 'true'
        : typeof query.hasGtin === 'boolean'
          ? query.hasGtin
          : null;

    const sortByRaw = normalizeString(query.sortBy) ?? 'updated_at';
    const sortOrderRaw = normalizeString(query.sortOrder) ?? 'desc';

    const sortByMap: Record<string, string> = {
      updated_at: 'p.updated_at_shopify',
      title: 'p.title',
      synced_at: 'p.synced_at',
      vendor: 'p.vendor',
      status: 'p.status',
      sync_status: 'pcm.sync_status',
    };
    const sortBy = sortByMap[sortByRaw] ?? sortByMap['updated_at'];
    const sortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';

    const { where, values } = buildFilters({
      search,
      status,
      vendor,
      productType,
      qualityLevel,
      syncStatus,
      categoryId,
      enrichmentStatus,
      hasGtin,
    });

    const offset = (page - 1) * limit;

    const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';
    const queryParams = [session.shopId, ...values, limit, offset];
    const limitParam = `$${values.length + 2}`;
    const offsetParam = `$${values.length + 3}`;

    const { rows, total } = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<ProductListRow>(
        `SELECT
           p.id,
           p.title,
           p.vendor,
           p.status,
           p.product_type as "productType",
           COALESCE(
             p.featured_image_url,
             pm_image.url,
             pm_image.preview_url,
             v_image.image_url
           ) as "featuredImageUrl",
           p.category_id as "categoryId",
           p.synced_at as "syncedAt",
           p.updated_at_shopify as "updatedAtShopify",
           COALESCE(v.variants_count, 0) as "variantsCount",
           pcm.sync_status as "syncStatus",
           pm.data_quality_level as "qualityLevel",
           pm.quality_score as "qualityScore"
         FROM shopify_products p
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int as variants_count
           FROM shopify_variants sv
           WHERE sv.product_id = p.id
             AND sv.shop_id = p.shop_id
         ) v ON true
         LEFT JOIN LATERAL (
           SELECT sm.url, sm.preview_url
           FROM shopify_product_media spm
           JOIN shopify_media sm
             ON sm.media_id = spm.media_id
            AND sm.shop_id = spm.shop_id
           WHERE spm.shop_id = p.shop_id
             AND spm.product_id = p.id
           ORDER BY spm.is_featured DESC, spm.position ASC
           LIMIT 1
         ) pm_image ON true
        LEFT JOIN LATERAL (
          SELECT sv.image_url
          FROM shopify_variants sv
          WHERE sv.shop_id = p.shop_id
            AND sv.product_id = p.id
            AND sv.image_url IS NOT NULL
          ORDER BY sv.position ASC
          LIMIT 1
        ) v_image ON true
         LEFT JOIN prod_channel_mappings pcm
           ON pcm.channel = 'shopify'
          AND pcm.shop_id = p.shop_id
          AND pcm.external_id = p.shopify_gid
         LEFT JOIN prod_master pm
           ON pm.id = pcm.product_id
         WHERE p.shop_id = $1
         ${whereSql}
         ORDER BY ${sortBy} ${sortOrder}
         LIMIT ${limitParam}
         OFFSET ${offsetParam}`,
        queryParams
      );

      const countResult = await client.query<{ total: number }>(
        `SELECT COUNT(*)::int as total
           FROM shopify_products p
           LEFT JOIN prod_channel_mappings pcm
             ON pcm.channel = 'shopify'
            AND pcm.shop_id = p.shop_id
            AND pcm.external_id = p.shopify_gid
           LEFT JOIN prod_master pm
             ON pm.id = pcm.product_id
           WHERE p.shop_id = $1
           ${whereSql}`,
        [session.shopId, ...values]
      );

      return { rows: result.rows, total: countResult.rows[0]?.total ?? 0 };
    });

    void reply.status(200).send(
      successEnvelope(request.id, {
        items: rows,
        page,
        limit,
        total,
      })
    );
  });

  server.get('/products/:id', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const productId = (request.params as { id?: string }).id;
    if (!productId) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing product id'));
      return;
    }

    const includeVariants =
      (request.query as { includeVariants?: string }).includeVariants === 'true';
    const detail = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<ProductDetailRow>(
        `SELECT
           p.id,
           p.title,
           p.handle,
           p.description,
           p.description_html as "descriptionHtml",
           p.vendor,
           p.status,
           p.product_type as "productType",
           p.tags,
           COALESCE(
             p.featured_image_url,
             pm_image.url,
             pm_image.preview_url,
             v_image.image_url
           ) as "featuredImageUrl",
           p.category_id as "categoryId",
           p.price_range as "priceRange",
           p.metafields,
           p.synced_at as "syncedAt",
           p.created_at_shopify as "createdAtShopify",
           p.updated_at_shopify as "updatedAtShopify",
           pm.id as "pimMasterId",
           pm.taxonomy_id as "pimTaxonomyId",
           pm.data_quality_level as "pimQualityLevel",
           pm.quality_score as "pimQualityScore",
           pm.quality_score_breakdown as "pimQualityScoreBreakdown",
           pm.brand as "pimBrand",
           pm.manufacturer as "pimManufacturer",
           pm.gtin as "pimGtin",
           pm.mpn as "pimMpn",
           pm.needs_review as "pimNeedsReview",
           pm.promoted_to_silver_at as "pimPromotedToSilverAt",
           pm.promoted_to_golden_at as "pimPromotedToGoldenAt",
           ps.title_master as "pimTitleMaster",
           ps.description_master as "pimDescriptionMaster",
           ps.description_short as "pimDescriptionShort"
         FROM shopify_products p
         LEFT JOIN prod_channel_mappings pcm
           ON pcm.channel = 'shopify'
          AND pcm.shop_id = p.shop_id
          AND pcm.external_id = p.shopify_gid
         LEFT JOIN prod_master pm
           ON pm.id = pcm.product_id
         LEFT JOIN prod_semantics ps
           ON ps.product_id = pm.id
         LEFT JOIN LATERAL (
           SELECT sm.url, sm.preview_url
           FROM shopify_product_media spm
           JOIN shopify_media sm
             ON sm.media_id = spm.media_id
            AND sm.shop_id = spm.shop_id
           WHERE spm.shop_id = p.shop_id
             AND spm.product_id = p.id
           ORDER BY spm.is_featured DESC, spm.position ASC
           LIMIT 1
         ) pm_image ON true
        LEFT JOIN LATERAL (
          SELECT sv.image_url
          FROM shopify_variants sv
          WHERE sv.shop_id = p.shop_id
            AND sv.product_id = p.id
            AND sv.image_url IS NOT NULL
          ORDER BY sv.position ASC
          LIMIT 1
        ) v_image ON true
        WHERE p.shop_id = $1
          AND p.id = $2`,
        [session.shopId, productId]
      );

      if (!result.rows[0]) return null;

      let variants: ProductVariantRow[] = [];
      if (includeVariants) {
        const resultVariants = await client.query<ProductVariantRow>(
          `SELECT
             id,
             sku,
             title,
             barcode,
             price,
             compare_at_price as "compareAtPrice",
             inventory_quantity as "inventoryQuantity",
             image_url as "imageUrl",
             selected_options as "selectedOptions"
           FROM shopify_variants
           WHERE shop_id = $1
             AND product_id = $2
           ORDER BY position ASC, id ASC`,
          [session.shopId, productId]
        );
        variants = resultVariants.rows;
      }

      return { detail: result.rows[0], variants };
    });

    if (!detail) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Product not found'));
      return;
    }

    // Convert raw breakdown to typed breakdown
    const rawBreakdown = detail.detail.pimQualityScoreBreakdown;
    const qualityScoreBreakdown: LocalProductPimData['qualityScoreBreakdown'] =
      rawBreakdown &&
      typeof rawBreakdown['completeness'] === 'number' &&
      typeof rawBreakdown['accuracy'] === 'number' &&
      typeof rawBreakdown['consistency'] === 'number'
        ? {
            completeness: rawBreakdown['completeness'],
            accuracy: rawBreakdown['accuracy'],
            consistency: rawBreakdown['consistency'],
          }
        : null;

    const pim: LocalProductPimData | null = detail.detail.pimMasterId
      ? {
          masterId: detail.detail.pimMasterId,
          taxonomyId: detail.detail.pimTaxonomyId,
          qualityLevel: detail.detail.pimQualityLevel ?? 'bronze',
          qualityScore: detail.detail.pimQualityScore
            ? Number(detail.detail.pimQualityScore)
            : null,
          qualityScoreBreakdown,
          titleMaster: detail.detail.pimTitleMaster,
          descriptionMaster: detail.detail.pimDescriptionMaster,
          descriptionShort: detail.detail.pimDescriptionShort,
          brand: detail.detail.pimBrand,
          manufacturer: detail.detail.pimManufacturer,
          gtin: detail.detail.pimGtin,
          mpn: detail.detail.pimMpn,
          needsReview: detail.detail.pimNeedsReview ?? false,
          promotedToSilverAt: detail.detail.pimPromotedToSilverAt,
          promotedToGoldenAt: detail.detail.pimPromotedToGoldenAt,
        }
      : null;

    const payload: ProductDetail = {
      id: detail.detail.id,
      title: detail.detail.title,
      handle: detail.detail.handle,
      description: detail.detail.description,
      descriptionHtml: detail.detail.descriptionHtml,
      vendor: detail.detail.vendor,
      status: detail.detail.status,
      productType: detail.detail.productType,
      tags: detail.detail.tags ?? [],
      featuredImageUrl: detail.detail.featuredImageUrl,
      priceRange: detail.detail.priceRange,
      metafields: detail.detail.metafields ?? {},
      categoryId: detail.detail.categoryId,
      syncedAt: detail.detail.syncedAt,
      createdAtShopify: detail.detail.createdAtShopify,
      updatedAtShopify: detail.detail.updatedAtShopify,
      pim,
      variants: detail.variants as ProductVariantDetail[],
    };

    void reply.status(200).send(successEnvelope(request.id, payload));
  });

  server.get('/products/:id/variants', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const productId = (request.params as { id?: string }).id;
    if (!productId) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing product id'));
      return;
    }

    const variants = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<ProductVariantRow>(
        `SELECT
           id,
           sku,
           title,
           barcode,
           price,
           compare_at_price as "compareAtPrice",
           inventory_quantity as "inventoryQuantity",
           image_url as "imageUrl",
           selected_options as "selectedOptions"
         FROM shopify_variants
         WHERE shop_id = $1
           AND product_id = $2
         ORDER BY position ASC, id ASC`,
        [session.shopId, productId]
      );
      return result.rows;
    });

    void reply.status(200).send(successEnvelope(request.id, { variants }));
  });

  server.get('/products/:id/quality-events', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const productId = (request.params as { id?: string }).id;
    if (!productId) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing product id'));
      return;
    }

    const events = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        event_type: string;
        previous_level: string | null;
        new_level: string;
        quality_score_before: string | null;
        quality_score_after: string | null;
        trigger_reason: string;
        created_at: string;
      }>(
        `SELECT qe.id,
                qe.event_type,
                qe.previous_level,
                qe.new_level,
                qe.quality_score_before,
                qe.quality_score_after,
                qe.trigger_reason,
                qe.created_at
           FROM prod_quality_events qe
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = qe.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products p
             ON p.shopify_gid = pcm.external_id
            AND p.shop_id = $1
          WHERE p.id = $2
          ORDER BY qe.created_at DESC`,
        [session.shopId, productId]
      );
      return result.rows;
    });

    void reply.status(200).send(successEnvelope(request.id, { events }));
  });

  server.get('/products/:id/matches', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const productId = (request.params as { id?: string }).id;
    if (!productId) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing product id'));
      return;
    }

    const matches = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        source_url: string;
        source_title: string | null;
        source_gtin: string | null;
        source_price: string | null;
        source_currency: string | null;
        similarity_score: string;
        match_confidence: string;
        created_at: string;
      }>(
        `SELECT m.id,
                m.source_url,
                m.source_title,
                m.source_gtin,
                m.source_price,
                m.source_currency,
                m.similarity_score,
                m.match_confidence,
                m.created_at
           FROM prod_similarity_matches m
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = m.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products p
             ON p.shopify_gid = pcm.external_id
            AND p.shop_id = $1
          WHERE p.id = $2
          ORDER BY m.similarity_score DESC`,
        [session.shopId, productId]
      );
      return result.rows;
    });

    void reply.status(200).send(successEnvelope(request.id, { matches }));
  });

  server.get('/products/:id/proposals', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const productId = (request.params as { id?: string }).id;
    if (!productId) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing product id'));
      return;
    }

    const proposals = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        field_path: string;
        current_value: unknown;
        proposed_value: unknown;
        confidence_score: string | null;
        proposal_status: string;
        priority: number;
        created_at: string;
      }>(
        `SELECT p.id,
                p.field_path,
                p.current_value,
                p.proposed_value,
                p.confidence_score,
                p.proposal_status,
                p.priority,
                p.created_at
           FROM prod_proposals p
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = p.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products sp
             ON sp.shopify_gid = pcm.external_id
            AND sp.shop_id = $1
          WHERE sp.id = $2
          ORDER BY p.priority DESC, p.created_at DESC`,
        [session.shopId, productId]
      );
      return result.rows;
    });

    void reply.status(200).send(successEnvelope(request.id, { proposals }));
  });

  server.put('/products/:id/pim', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const productId = (request.params as { id?: string }).id;
    if (!productId) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing product id'));
      return;
    }

    const body = (request.body ?? {}) as {
      titleMaster?: unknown;
      descriptionMaster?: unknown;
      descriptionShort?: unknown;
      taxonomyId?: unknown;
      brand?: unknown;
      manufacturer?: unknown;
      gtin?: unknown;
      mpn?: unknown;
      metafields?: unknown;
    };

    const titleMaster = normalizeString(body.titleMaster);
    const descriptionMaster = normalizeString(body.descriptionMaster);
    const descriptionShort = normalizeString(body.descriptionShort);
    const taxonomyId = normalizeString(body.taxonomyId);
    const brand = normalizeString(body.brand);
    const manufacturer = normalizeString(body.manufacturer);
    const gtinRaw = normalizeString(body.gtin);
    const gtin = gtinRaw ? normalizeGTIN(gtinRaw) : null;
    if (gtinRaw && !gtin) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'GTIN invalid (checksum esuat)'));
      return;
    }
    const mpn = normalizeString(body.mpn);
    let metafields: Record<string, unknown> | null = null;
    if (typeof body.metafields === 'string') {
      try {
        metafields = JSON.parse(body.metafields) as Record<string, unknown>;
      } catch {
        metafields = null;
      }
    } else if (body.metafields && typeof body.metafields === 'object') {
      metafields = body.metafields as Record<string, unknown>;
    }

    const updated = await withTenantContext(session.shopId, async (client) => {
      const mapping = await client.query<{ product_id: string }>(
        `SELECT product_id
           FROM prod_channel_mappings
          WHERE channel = 'shopify'
            AND shop_id = $1
            AND external_id = (
              SELECT shopify_gid
              FROM shopify_products
              WHERE shop_id = $1
                AND id = $2
            )`,
        [session.shopId, productId]
      );
      const pimId = mapping.rows[0]?.product_id;
      if (!pimId) return null;

      await client.query(
        `UPDATE prod_master
         SET
           taxonomy_id = COALESCE($2, taxonomy_id),
           brand = COALESCE($3, brand),
           manufacturer = COALESCE($4, manufacturer),
           gtin = COALESCE($5, gtin),
           mpn = COALESCE($6, mpn),
           updated_at = now()
         WHERE id = $1`,
        [pimId, taxonomyId, brand, manufacturer, gtin, mpn]
      );

      await client.query(
        `INSERT INTO prod_semantics (product_id, title_master, description_master, description_short, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (product_id)
         DO UPDATE SET
           title_master = COALESCE(EXCLUDED.title_master, prod_semantics.title_master),
           description_master = COALESCE(EXCLUDED.description_master, prod_semantics.description_master),
           description_short = COALESCE(EXCLUDED.description_short, prod_semantics.description_short),
           updated_at = now()`,
        [pimId, titleMaster ?? '', descriptionMaster, descriptionShort]
      );

      if (metafields) {
        await client.query(
          `UPDATE shopify_products
           SET metafields = $3,
               updated_at = now(),
               updated_at_shopify = now()
           WHERE shop_id = $1
             AND id = $2`,
          [session.shopId, productId, metafields]
        );
      }

      return pimId;
    });

    if (!updated) {
      void reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'PIM record not found'));
      return;
    }

    void reply.status(200).send(successEnvelope(request.id, { ok: true }));
  });

  server.post('/products/bulk-sync', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const body = (request.body ?? {}) as { productIds?: unknown };
    const productIds =
      Array.isArray(body.productIds) && body.productIds.length
        ? body.productIds.filter((id) => typeof id === 'string')
        : [];

    if (!productIds.length) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing productIds'));
      return;
    }

    if (productIds.length > 100) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Max 100 products per bulk sync'));
      return;
    }

    const shopifyIds = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ shopify_gid: string }>(
        `SELECT shopify_gid
         FROM shopify_products
         WHERE shop_id = $1
           AND id = ANY($2::uuid[])`,
        [session.shopId, productIds]
      );
      return result.rows.map((row) => row.shopify_gid);
    });

    if (shopifyIds.length === 0) {
      void reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Products not found'));
      return;
    }

    const idsLiteral = shopifyIds.map((id) => `"${id}"`).join(',');
    const graphqlQuery = `query {
  nodes(ids: [${idsLiteral}]) {
    ... on Product {
      id
      title
      handle
      updatedAt
      vendor
      status
    }
  }
}`;

    const payload: BulkOrchestratorJobPayload = {
      shopId: session.shopId,
      operationType: 'PRODUCTS_EXPORT',
      queryType: 'products.selected',
      queryVersion: 'v1',
      graphqlQuery,
      triggeredBy: 'manual',
      requestedAt: Date.now(),
    };

    await enqueueBulkOrchestratorJob(payload, logger);

    logger.info({ shopId: session.shopId, productIds }, 'bulk_sync_requested');
    void reply.status(202).send(successEnvelope(request.id, { status: 'queued', productIds }));
  });

  server.post('/products/bulk-compare', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const body = (request.body ?? {}) as { productIds?: unknown };
    const productIds = parseProductIds(body.productIds);
    if (!productIds.length) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing productIds'));
      return;
    }
    if (productIds.length > 100) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Max 100 products per compare'));
      return;
    }

    const items = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        title: string;
        vendor: string | null;
        status: string | null;
        productType: string | null;
        featuredImageUrl: string | null;
        priceRange: { min: string; max: string; currency: string } | null;
        qualityLevel: string | null;
        qualityScore: string | null;
        taxonomyId: string | null;
        gtin: string | null;
        mpn: string | null;
        titleMaster: string | null;
        descriptionShort: string | null;
      }>(
        `SELECT
           p.id,
           p.title,
           p.vendor,
           p.status,
           p.product_type as "productType",
           COALESCE(
             p.featured_image_url,
             pm_image.url,
             pm_image.preview_url,
             v_image.image_url
           ) as "featuredImageUrl",
           p.price_range as "priceRange",
           pm.data_quality_level as "qualityLevel",
           pm.quality_score as "qualityScore",
           pm.taxonomy_id as "taxonomyId",
           pm.gtin,
           pm.mpn,
           ps.title_master as "titleMaster",
           ps.description_short as "descriptionShort"
         FROM shopify_products p
         LEFT JOIN prod_channel_mappings pcm
           ON pcm.external_id = p.shopify_gid
          AND pcm.channel = 'shopify'
          AND pcm.shop_id = p.shop_id
         LEFT JOIN LATERAL (
           SELECT sm.url, sm.preview_url
           FROM shopify_product_media spm
           JOIN shopify_media sm
             ON sm.media_id = spm.media_id
            AND sm.shop_id = spm.shop_id
           WHERE spm.shop_id = p.shop_id
             AND spm.product_id = p.id
           ORDER BY spm.is_featured DESC, spm.position ASC
           LIMIT 1
         ) pm_image ON true
        LEFT JOIN LATERAL (
          SELECT sv.image_url
          FROM shopify_variants sv
          WHERE sv.shop_id = p.shop_id
            AND sv.product_id = p.id
            AND sv.image_url IS NOT NULL
          ORDER BY sv.position ASC
          LIMIT 1
        ) v_image ON true
         LEFT JOIN prod_master pm ON pm.id = pcm.product_id
         LEFT JOIN prod_semantics ps ON ps.product_id = pm.id
         WHERE p.shop_id = $1
           AND p.id = ANY($2::uuid[])`,
        [session.shopId, productIds]
      );
      return result.rows;
    });

    void reply.status(200).send(successEnvelope(request.id, { items }));
  });

  server.post('/products/bulk-assign-category', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const body = (request.body ?? {}) as { productIds?: unknown; categoryId?: unknown };
    const productIds = parseProductIds(body.productIds);
    const categoryId = normalizeString(body.categoryId);
    if (!productIds.length || !categoryId) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing productIds or categoryId'));
      return;
    }
    if (productIds.length > 100) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Max 100 products per bulk action'));
      return;
    }

    const updated = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ updated: number }>(
        `UPDATE shopify_products
           SET category_id = $3,
               updated_at = now(),
               updated_at_shopify = now()
         WHERE shop_id = $1
           AND id = ANY($2::uuid[])
         RETURNING 1`,
        [session.shopId, productIds, categoryId]
      );
      return result.rows.length;
    });

    void reply.status(200).send(successEnvelope(request.id, { updated }));
  });

  server.post('/products/bulk-add-to-collection', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const body = (request.body ?? {}) as { productIds?: unknown; collectionId?: unknown };
    const productIds = parseProductIds(body.productIds);
    const collectionId = normalizeString(body.collectionId);
    if (!productIds.length || !collectionId) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing productIds or collectionId'));
      return;
    }
    if (productIds.length > 100) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Max 100 products per bulk action'));
      return;
    }

    const inserted = await withTenantContext(session.shopId, async (client) => {
      const collection = await client.query<{ id: string }>(
        `SELECT id
           FROM shopify_collections
          WHERE shop_id = $1
            AND id = $2`,
        [session.shopId, collectionId]
      );
      if (!collection.rows.length) return 0;

      const values: string[] = [];
      const params: unknown[] = [session.shopId, collectionId];
      productIds.forEach((id, idx) => {
        params.push(id);
        values.push(`($1, $2, $${idx + 3})`);
      });
      const query = `INSERT INTO shopify_collection_products (shop_id, collection_id, product_id)
                     VALUES ${values.join(',')}
                     ON CONFLICT (collection_id, product_id) DO NOTHING`;
      const result = await client.query(query, params);
      return (result as { rowCount?: number }).rowCount ?? 0;
    });

    void reply.status(200).send(successEnvelope(request.id, { inserted }));
  });

  server.post('/products/bulk-request-enrichment', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const body = (request.body ?? {}) as { productIds?: unknown };
    const productIds = parseProductIds(body.productIds);
    if (!productIds.length) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing productIds'));
      return;
    }
    if (productIds.length > 100) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Max 100 products per bulk action'));
      return;
    }

    const payload: EnrichmentJobPayload = {
      shopId: session.shopId,
      productIds,
      triggeredBy: 'manual',
      requestedAt: Date.now(),
    };

    try {
      await enqueueEnrichmentJob(payload, logger);
      void reply.status(202).send(successEnvelope(request.id, { status: 'queued', productIds }));
    } catch (error) {
      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ updated: number }>(
          `UPDATE prod_master pm
             SET needs_review = true,
                 updated_at = now()
            FROM prod_channel_mappings pcm
            JOIN shopify_products p
              ON p.shopify_gid = pcm.external_id
             AND p.shop_id = $1
           WHERE pcm.product_id = pm.id
             AND pcm.channel = 'shopify'
             AND pcm.shop_id = $1
             AND p.id = ANY($2::uuid[])
           RETURNING 1`,
          [session.shopId, productIds]
        );
        return result.rows.length;
      });

      logger.warn(
        { error, shopId: session.shopId, productCount: productIds.length },
        'Enrichment enqueue failed; fallback to needs_review'
      );
      void reply.status(202).send(
        successEnvelope(request.id, {
          status: 'fallback',
          updated,
        })
      );
    }
  });

  server.get('/collections', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const collections = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        title: string;
        collectionType: string;
        productsCount: number;
      }>(
        `SELECT id,
                title,
                collection_type as "collectionType",
                products_count as "productsCount"
           FROM shopify_collections
          WHERE shop_id = $1
          ORDER BY title ASC`,
        [session.shopId]
      );
      return result.rows;
    });

    void reply.status(200).send(successEnvelope(request.id, { collections }));
  });

  server.get('/products/review', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const type = (request.query as { type?: string }).type ?? 'match';

    if (type === 'match' || type === 'hitl') {
      const whereClause =
        type === 'hitl'
          ? `m.match_confidence = 'pending' AND (m.match_details ->> 'requires_human_review') = 'true'`
          : `m.match_confidence = 'pending'`;
      const matches = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          product_id: string;
          source_url: string;
          source_title: string | null;
          source_gtin: string | null;
          source_price: string | null;
          source_currency: string | null;
          similarity_score: string;
          match_confidence: string;
          match_method: string;
          created_at: string;
          product_title: string;
        }>(
          `SELECT m.id,
                  m.product_id,
                  m.source_url,
                  m.source_title,
                  m.source_gtin,
                  m.source_price,
                  m.source_currency,
                  m.similarity_score,
                  m.match_confidence,
                  m.match_method,
                  m.created_at,
                  sp.title as product_title
             FROM prod_similarity_matches m
             JOIN prod_channel_mappings pcm
               ON pcm.product_id = m.product_id
              AND pcm.channel = 'shopify'
              AND pcm.shop_id = $1
             JOIN shopify_products sp
               ON sp.shopify_gid = pcm.external_id
              AND sp.shop_id = $1
           WHERE ${whereClause}
            ORDER BY m.similarity_score DESC, m.created_at DESC
            LIMIT 200`,
          [session.shopId]
        );
        return result.rows;
      });

      void reply.status(200).send(successEnvelope(request.id, { items: matches, type }));
      return;
    }

    const proposals = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        product_id: string;
        field_path: string;
        current_value: unknown;
        proposed_value: unknown;
        confidence_score: string | null;
        proposal_status: string;
        priority: number;
        created_at: string;
        product_title: string;
      }>(
        `SELECT p.id,
                p.product_id,
                p.field_path,
                p.current_value,
                p.proposed_value,
                p.confidence_score,
                p.proposal_status,
                p.priority,
                p.created_at,
                sp.title as product_title
           FROM prod_proposals p
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = p.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products sp
             ON sp.shopify_gid = pcm.external_id
            AND sp.shop_id = $1
          WHERE p.proposal_status = 'pending'
          ORDER BY p.priority DESC, p.created_at DESC
          LIMIT 200`,
        [session.shopId]
      );
      return result.rows;
    });

    void reply
      .status(200)
      .send(successEnvelope(request.id, { items: proposals, type: 'proposal' }));
  });

  server.post('/products/review/:id/confirm', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: string }).id;
    if (!id) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    const productId = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ product_id: string }>(
        `UPDATE prod_similarity_matches
         SET match_confidence = 'confirmed',
             verified_at = now()
         WHERE id = $1
         RETURNING product_id`,
        [id]
      );
      return result.rows[0]?.product_id ?? null;
    });

    if (productId) {
      await enqueueConsensusJob({
        shopId: session.shopId,
        productId,
        trigger: 'match_confirmed',
      });
    }

    void reply.status(200).send(successEnvelope(request.id, { ok: true }));
  });

  server.post('/products/review/:id/reject', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: string }).id;
    if (!id) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    const body = (request.body ?? {}) as { reason?: string };
    await withTenantContext(session.shopId, async (client) => {
      await client.query(
        `UPDATE prod_similarity_matches
         SET match_confidence = 'rejected',
             rejection_reason = $2,
             verified_at = now()
         WHERE id = $1`,
        [id, body.reason ?? null]
      );
    });

    void reply.status(200).send(successEnvelope(request.id, { ok: true }));
  });

  server.post('/products/proposals/:id/approve', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: string }).id;
    if (!id) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    await withTenantContext(session.shopId, async (client) => {
      await client.query(
        `UPDATE prod_proposals
         SET proposal_status = 'approved',
             reviewed_at = now()
         WHERE id = $1`,
        [id]
      );
    });

    void reply.status(200).send(successEnvelope(request.id, { ok: true }));
  });

  server.post('/products/proposals/:id/reject', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: string }).id;
    if (!id) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    const body = (request.body ?? {}) as { reason?: string };
    await withTenantContext(session.shopId, async (client) => {
      await client.query(
        `UPDATE prod_proposals
         SET proposal_status = 'rejected',
             review_notes = $2,
             reviewed_at = now()
         WHERE id = $1`,
        [id, body.reason ?? null]
      );
    });

    void reply.status(200).send(successEnvelope(request.id, { ok: true }));
  });

  server.post('/products/import', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const parts = request.parts();
    let data: Awaited<ReturnType<typeof request.file>> | null = null;
    const options = {
      dryRun: false,
      skipErrors: false,
      updateExisting: false,
      triggerEnrichment: false,
    };

    for await (const part of parts) {
      if (part.type === 'file') {
        data = part;
        continue;
      }
      const rawValue = part.value;
      const value =
        typeof rawValue === 'string'
          ? rawValue
          : typeof rawValue === 'number' || typeof rawValue === 'boolean'
            ? String(rawValue)
            : '';
      if (part.fieldname === 'dryRun') options.dryRun = value === 'true';
      if (part.fieldname === 'skipErrors') options.skipErrors = value === 'true';
      if (part.fieldname === 'updateExisting') options.updateExisting = value === 'true';
      if (part.fieldname === 'triggerEnrichment') options.triggerEnrichment = value === 'true';
    }

    if (!data) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing file'));
      return;
    }

    const jobId = randomUUID();
    await setJob(redis, 'import', jobId, {
      jobId,
      shopId: session.shopId,
      status: 'queued',
      progress: 0,
    } satisfies ImportJob);

    void reply.status(202).send(
      successEnvelope(request.id, {
        jobId,
        status: 'queued',
      })
    );

    const buffer = await data.toBuffer();
    const filename = data.filename ?? 'upload';
    const isJson = filename.endsWith('.json') || filename.endsWith('.jsonl');
    const isCsv = filename.endsWith('.csv');

    void (async () => {
      try {
        await setJob(redis, 'import', jobId, {
          jobId,
          shopId: session.shopId,
          status: 'processing',
          progress: 10,
        } satisfies ImportJob);

        const payload = buffer.toString('utf-8');
        const parsedData: unknown = isJson
          ? JSON.parse(payload)
          : isCsv
            ? parseCsvPayload(payload)
            : [];

        if (!Array.isArray(parsedData)) throw new Error('Unsupported file format');
        const rows = parsedData as Record<string, string>[];

        const errors: { row: number; message: string }[] = [];
        const validRows: Record<string, string>[] = [];
        const previewRows: ImportJob['previewRows'] = [];

        rows.forEach((row, index) => {
          const title = normalizeString(row['title']);
          const priceRaw = normalizeString(row['price']);
          if (!title) {
            errors.push({ row: index + 1, message: 'Title required' });
            previewRows.push({ row: index + 1, data: row, error: 'Title required' });
            return;
          }
          if (!priceRaw || !Number.isFinite(Number(priceRaw))) {
            errors.push({ row: index + 1, message: 'Price required' });
            previewRows.push({ row: index + 1, data: row, error: 'Price required' });
            return;
          }
          validRows.push(row);
          if (previewRows.length < 20) previewRows.push({ row: index + 1, data: row });
        });

        await setJob(redis, 'import', jobId, {
          jobId,
          shopId: session.shopId,
          status: 'processing',
          progress: 60,
          summary: { total: rows.length, valid: validRows.length, errors: errors.length },
          errors,
          previewRows,
        } satisfies ImportJob);

        if (!options.dryRun) {
          await withTenantContext(session.shopId, async (client) => {
            for (let idx = 0; idx < validRows.length; idx += 1) {
              const row = validRows[idx];
              if (!row) continue;
              const title = normalizeString(row['title']) ?? '';
              const vendor = normalizeString(row['vendor']);
              const productType =
                normalizeString(row['product_type']) ?? normalizeString(row['productType']);
              const description = normalizeString(row['description']);
              const status = normalizeStatus(normalizeString(row['status'])) ?? 'DRAFT';
              const handle = normalizeString(row['handle']) ?? slugify(title);
              const price = normalizeString(row['price']) ?? '0';
              const sku = normalizeString(row['sku']);
              const barcode = normalizeString(row['barcode']);

              if (options.updateExisting && sku) {
                const existing = await client.query<{ product_id: string }>(
                  `SELECT product_id
                 FROM shopify_variants
                 WHERE shop_id = $1
                   AND sku = $2
                 LIMIT 1`,
                  [session.shopId, sku]
                );
                const productId = existing.rows[0]?.product_id;
                if (productId) {
                  await client.query(
                    `UPDATE shopify_products
                   SET title = $2,
                       vendor = $3,
                       product_type = $4,
                       status = $5,
                       description = $6,
                       updated_at = now(),
                       updated_at_shopify = now()
                   WHERE id = $1
                     AND shop_id = $7`,
                    [productId, title, vendor, productType, status, description, session.shopId]
                  );
                  await client.query(
                    `UPDATE shopify_variants
                   SET price = $2,
                       compare_at_price = $3,
                       barcode = COALESCE($4, barcode),
                       updated_at = now(),
                       updated_at_shopify = now()
                   WHERE product_id = $1
                     AND shop_id = $5`,
                    [productId, price, price, barcode, session.shopId]
                  );
                  continue;
                }
              }

              const legacyResourceId = Date.now() + idx;
              const shopifyGid = `gid://shopify/Product/${legacyResourceId}`;

              const productInsert = await client.query<{ id: string }>(
                `INSERT INTO shopify_products (
                 shop_id,
                 shopify_gid,
                 legacy_resource_id,
                 title,
                 handle,
                 description,
                 vendor,
                 product_type,
                 status,
                 tags,
                 options,
                 metafields,
                 created_at_shopify,
                 updated_at_shopify,
                 synced_at,
                 created_at,
                 updated_at
               )
               VALUES (
                 $1,
                 $2,
                 $3,
                 $4,
                 $5,
                 $6,
                 $7,
                 $8,
                 $9,
                 ARRAY[]::text[],
                 '[]'::jsonb,
                 '{}'::jsonb,
                 now(),
                 now(),
                 now(),
                 now(),
                 now()
               )
               RETURNING id`,
                [
                  session.shopId,
                  shopifyGid,
                  legacyResourceId,
                  title,
                  handle,
                  description,
                  vendor,
                  productType,
                  status,
                ]
              );

              const productId = productInsert.rows[0]?.id;
              if (!productId) continue;

              const variantLegacyId = legacyResourceId + 1000;
              const variantGid = `gid://shopify/ProductVariant/${variantLegacyId}`;

              await client.query(
                `INSERT INTO shopify_variants (
                 shop_id,
                 product_id,
                 shopify_gid,
                 legacy_resource_id,
                 title,
                 sku,
                 barcode,
                 price,
                 compare_at_price,
                 inventory_quantity,
                 selected_options,
                 created_at_shopify,
                 updated_at_shopify,
                 synced_at,
                 created_at,
                 updated_at
               )
               VALUES (
                 $1,
                 $2,
                 $3,
                 $4,
                 $5,
                 $6,
                 $7,
                 $8,
                 $9,
                 0,
                 '[]'::jsonb,
                 now(),
                 now(),
                 now(),
                 now(),
                 now()
               )`,
                [
                  session.shopId,
                  productId,
                  variantGid,
                  variantLegacyId,
                  title,
                  sku,
                  barcode,
                  price,
                  price,
                ]
              );
            }
          });
        }

        await setJob(redis, 'import', jobId, {
          jobId,
          shopId: session.shopId,
          status: 'completed',
          progress: 100,
          summary: { total: rows.length, valid: validRows.length, errors: errors.length },
          errors,
        } satisfies ImportJob);
      } catch (error) {
        await setJob(redis, 'import', jobId, {
          jobId,
          shopId: session.shopId,
          status: 'failed',
          progress: 100,
          error: error instanceof Error ? error.message : 'Import failed',
        } satisfies ImportJob);
      }
    })();
  });

  server.get('/products/import/:jobId', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const jobId = (request.params as { jobId?: string }).jobId;
    const job = jobId ? await getJob<ImportJob>(redis, 'import', jobId) : null;
    if (!jobId || !job) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Import not found'));
      return;
    }

    if (job?.shopId !== session.shopId) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Import not found'));
      return;
    }

    void reply.status(200).send(
      successEnvelope(request.id, {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        summary: job.summary,
        errors: job.errors,
        error: job.error,
      })
    );
  });

  server.post('/products/export', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const format = body['format'];
    if (format !== 'csv' && format !== 'json' && format !== 'excel') {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid format'));
      return;
    }

    const filters = body['filters'] as Record<string, unknown> | undefined;
    const search = normalizeString(filters?.['search']);
    const status = normalizeStatus(normalizeString(filters?.['status']));
    const vendorFilter = filters?.['vendor'];
    const vendor = Array.isArray(vendorFilter)
      ? (vendorFilter as string[])
      : parseArrayParam(vendorFilter);
    const productTypeFilter = filters?.['productType'];
    const productType = Array.isArray(productTypeFilter)
      ? (productTypeFilter as string[])
      : parseArrayParam(productTypeFilter);
    const qualityLevelFilter = filters?.['qualityLevel'];
    const qualityLevel = Array.isArray(qualityLevelFilter)
      ? (qualityLevelFilter as string[])
      : parseArrayParam(qualityLevelFilter);
    const syncStatusFilter = filters?.['syncStatus'];
    const syncStatus = Array.isArray(syncStatusFilter)
      ? (syncStatusFilter as string[])
      : parseArrayParam(syncStatusFilter);
    const enrichmentStatusFilter = filters?.['enrichmentStatus'];
    const enrichmentStatus = Array.isArray(enrichmentStatusFilter)
      ? (enrichmentStatusFilter as string[])
      : parseArrayParam(enrichmentStatusFilter);
    const categoryId = normalizeString(filters?.['categoryId']);
    const hasGtinFilter = filters?.['hasGtin'];
    const hasGtin =
      typeof hasGtinFilter === 'boolean'
        ? hasGtinFilter
        : typeof hasGtinFilter === 'string'
          ? hasGtinFilter === 'true'
          : null;

    const { where, values } = buildFilters({
      search,
      status,
      vendor,
      productType,
      qualityLevel,
      syncStatus,
      categoryId,
      enrichmentStatus,
      hasGtin,
    });

    const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';
    const jobId = randomUUID();
    const initial: ExportJob = {
      jobId,
      shopId: session.shopId,
      status: 'queued',
      progress: 0,
      format,
    };
    await setJob(redis, 'export', jobId, initial);

    void reply.status(202).send(
      successEnvelope(request.id, {
        jobId,
        status: 'queued',
      })
    );

    void (async () => {
      await setJob(redis, 'export', jobId, { ...initial, status: 'processing', progress: 10 });
      try {
        const rows = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<ProductListRow>(
            `SELECT
               p.id,
               p.title,
               p.vendor,
               p.status,
               p.product_type as "productType",
               COALESCE(
                 p.featured_image_url,
                 pm_image.url,
                 pm_image.preview_url,
                 v_image.image_url
               ) as "featuredImageUrl",
               p.category_id as "categoryId",
               p.synced_at as "syncedAt",
               pm.data_quality_level as "qualityLevel"
             FROM shopify_products p
             LEFT JOIN prod_channel_mappings pcm
               ON pcm.channel = 'shopify'
              AND pcm.shop_id = p.shop_id
              AND pcm.external_id = p.shopify_gid
             LEFT JOIN LATERAL (
               SELECT sm.url, sm.preview_url
               FROM shopify_product_media spm
               JOIN shopify_media sm
                 ON sm.media_id = spm.media_id
                AND sm.shop_id = spm.shop_id
               WHERE spm.shop_id = p.shop_id
                 AND spm.product_id = p.id
               ORDER BY spm.is_featured DESC, spm.position ASC
               LIMIT 1
             ) pm_image ON true
             LEFT JOIN LATERAL (
               SELECT sv.image_url
               FROM shopify_variants sv
               WHERE sv.shop_id = p.shop_id
                 AND sv.product_id = p.id
                 AND sv.image_url IS NOT NULL
               ORDER BY sv.position ASC
               LIMIT 1
             ) v_image ON true
             LEFT JOIN prod_master pm
               ON pm.id = pcm.product_id
             WHERE p.shop_id = $1
             ${whereSql}
             ORDER BY p.updated_at_shopify desc`,
            [session.shopId, ...values]
          );
          return result.rows;
        });

        await setJob(redis, 'export', jobId, { ...initial, status: 'processing', progress: 70 });

        const payload =
          format === 'csv'
            ? toCsv(rows)
            : format === 'excel'
              ? toExcel(rows)
              : JSON.stringify(rows, null, 2);
        const contentType =
          format === 'csv'
            ? 'text/csv'
            : format === 'excel'
              ? 'application/vnd.ms-excel'
              : 'application/json';
        await setJob(redis, 'export', jobId, {
          ...initial,
          status: 'completed',
          progress: 100,
          payload,
          contentType,
          downloadUrl: `/api/products/export/${jobId}/download`,
        } satisfies ExportJob);
      } catch (error) {
        await setJob(redis, 'export', jobId, {
          ...initial,
          status: 'failed',
          progress: 100,
          error: error instanceof Error ? error.message : 'Export failed',
        } satisfies ExportJob);
      }
    })();
  });

  server.get('/products/export/:jobId', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const jobId = (request.params as { jobId?: string }).jobId;
    const job = jobId ? await getJob<ExportJob>(redis, 'export', jobId) : null;
    if (!jobId || !job) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Export not found'));
      return;
    }

    if (job?.shopId !== session.shopId) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Export not found'));
      return;
    }

    void reply.status(200).send(
      successEnvelope(request.id, {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        downloadUrl: job.downloadUrl,
        error: job.error,
      })
    );
  });

  server.get('/products/export/:jobId/download', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const jobId = (request.params as { jobId?: string }).jobId;
    const job = jobId ? await getJob<ExportJob>(redis, 'export', jobId) : null;
    if (job?.shopId !== session.shopId || job?.status !== 'completed' || !job?.payload) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Export not found'));
      return;
    }

    reply.header('Content-Type', job.contentType ?? 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="products-export.${job.format}"`);
    void reply.status(200).send(Readable.from(job.payload));
  });

  return Promise.resolve();
};
