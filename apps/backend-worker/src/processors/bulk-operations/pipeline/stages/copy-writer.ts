import { withTenantContext } from '@app/database';

import type {
  StitchedRecord,
  StagingProductRowShape,
  StagingVariantRowShape,
} from './transformation/stitching/parent-child-remapper.js';
import {
  toStagingProductRowShape,
  toStagingVariantRowShape,
} from './transformation/stitching/parent-child-remapper.js';
import { withBulkSpan } from '../../otel/spans.js';
import { insertBulkError } from '../../state-machine.js';

function extractLegacyResourceId(gid: string): number | null {
  // Shopify GID format: gid://shopify/Product/123456
  const idx = gid.lastIndexOf('/');
  if (idx < 0) return null;
  const raw = gid.slice(idx + 1);
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

export type CopyWriterCounters = Readonly<{
  recordsSeen: number;
  recordsSkipped: number;
  productsBuffered: number;
  variantsBuffered: number;
  productsCopied: number;
  variantsCopied: number;
  mediaBuffered: number;
  productMediaBuffered: number;
  variantMediaBuffered: number;
  mediaCopied: number;
  productMediaCopied: number;
  variantMediaCopied: number;
  metafieldProductPatchesBuffered: number;
  metafieldVariantPatchesBuffered: number;
  metafieldProductPatchesFlushed: number;
  metafieldVariantPatchesFlushed: number;
  metafieldFlushErrors: number;
}>;

type StagingMediaRowShape = Readonly<{
  shopify_gid: string;
  legacy_resource_id: number | null;
  media_type: 'IMAGE' | 'VIDEO' | 'MODEL_3D' | 'EXTERNAL_VIDEO';
  alt: string | null;
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED' | null;
  mime_type: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  url: string | null;
  preview_url: string | null;
  sources: unknown;
  metadata: unknown;
  raw_data: unknown;
}>;

type StagingProductMediaRowShape = Readonly<{
  product_shopify_gid: string;
  media_shopify_gid: string;
  position: number;
  is_featured: boolean;
}>;

type StagingVariantMediaRowShape = Readonly<{
  variant_shopify_gid: string;
  media_shopify_gid: string;
  position: number;
}>;

export type MetafieldPatchWriterCounters = Readonly<{
  productPatchesBuffered: number;
  variantPatchesBuffered: number;
  productPatchesFlushed: number;
  variantPatchesFlushed: number;
  flushErrors: number;
}>;

/**
 * Accumulates metafield patches from `product_metafields_patch` and
 * `variant_metafields_patch` stitched records, then applies them as batch
 * JSONB || UPDATE statements directly on `shopify_products` / `shopify_variants`.
 *
 * This bypasses the staging tables entirely -- metafields from a `meta` bulk
 * run are written straight to the live tables, which is correct since the meta
 * JSONL contains only id + metafields (no product scalar fields to stage).
 */
export class MetafieldPatchWriter {
  private readonly shopId: string;
  private readonly bulkRunId: string;
  private readonly batchMaxRows: number;

  /** GID -> { namespace: { key: value } } */
  private productBuffer = new Map<string, Record<string, unknown>>();
  private variantBuffer = new Map<string, Record<string, unknown>>();

  private mutable = {
    productPatchesBuffered: 0,
    variantPatchesBuffered: 0,
    productPatchesFlushed: 0,
    variantPatchesFlushed: 0,
    flushErrors: 0,
  };

  constructor(params: { shopId: string; bulkRunId: string; batchMaxRows: number }) {
    this.shopId = params.shopId;
    this.bulkRunId = params.bulkRunId;
    this.batchMaxRows = Math.max(1, params.batchMaxRows);
  }

  public getCounters(): MetafieldPatchWriterCounters {
    return {
      productPatchesBuffered: this.mutable.productPatchesBuffered,
      variantPatchesBuffered: this.mutable.variantPatchesBuffered,
      productPatchesFlushed: this.mutable.productPatchesFlushed,
      variantPatchesFlushed: this.mutable.variantPatchesFlushed,
      flushErrors: this.mutable.flushErrors,
    };
  }

  public shouldFlush(): boolean {
    return (
      this.productBuffer.size >= this.batchMaxRows || this.variantBuffer.size >= this.batchMaxRows
    );
  }

  public handleProductPatch(
    record: Extract<StitchedRecord, { kind: 'product_metafields_patch' }>
  ): void {
    this.mergeMetafieldIntoBuffer(this.productBuffer, record.ownerId, record.patch);
    this.mutable.productPatchesBuffered += 1;
  }

  public handleVariantPatch(
    record: Extract<StitchedRecord, { kind: 'variant_metafields_patch' }>
  ): void {
    this.mergeMetafieldIntoBuffer(this.variantBuffer, record.ownerId, record.patch);
    this.mutable.variantPatchesBuffered += 1;
  }

  private mergeMetafieldIntoBuffer(
    buffer: Map<string, Record<string, unknown>>,
    ownerId: string,
    patch: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  ): void {
    let existing = buffer.get(ownerId);
    if (!existing) {
      existing = {};
      buffer.set(ownerId, existing);
    }
    // Deep merge: namespace -> key -> value
    for (const [ns, keys] of Object.entries(patch)) {
      const existingNs = existing[ns];
      const mergedNs: Record<string, unknown> =
        existingNs && typeof existingNs === 'object'
          ? { ...(existingNs as Record<string, unknown>) }
          : {};
      for (const [k, v] of Object.entries(keys)) {
        mergedNs[k] = v;
      }
      existing[ns] = mergedNs;
    }
  }

  public async flush(): Promise<void> {
    await this.flushBuffer(this.productBuffer, 'shopify_products', 'product');
    await this.flushBuffer(this.variantBuffer, 'shopify_variants', 'variant');
  }

  private async flushBuffer(
    buffer: Map<string, Record<string, unknown>>,
    table: 'shopify_products' | 'shopify_variants',
    kind: 'product' | 'variant'
  ): Promise<void> {
    if (buffer.size === 0) return;

    const entries = Array.from(buffer.entries());
    buffer.clear();

    await withBulkSpan(
      'bulk.metafield_patch.flush',
      {
        shopId: this.shopId,
        bulkRunId: this.bulkRunId,
        step: 'metafield_patch',
      },
      async (span) => {
        span.setAttribute('bulk.batch_rows', entries.length);
        span.setAttribute('bulk.target_table', table);

        try {
          await withTenantContext(this.shopId, async (client) => {
            const values: unknown[] = [];
            const placeholders: string[] = [];
            let idx = 1;
            for (const [gid, patch] of entries) {
              placeholders.push(`($${idx++}::text, $${idx++}::jsonb)`);
              values.push(gid, JSON.stringify(patch));
            }

            const shopIdColumn = table === 'shopify_products' ? 'shop_id' : 'shop_id';
            await client.query(
              `UPDATE ${table} t
               SET metafields = COALESCE(t.metafields, '{}'::jsonb) || batch.patch,
                   updated_at = now()
               FROM (VALUES ${placeholders.join(', ')}) AS batch(shopify_gid, patch)
               WHERE t.${shopIdColumn} = $${idx}
                 AND t.shopify_gid = batch.shopify_gid`,
              [...values, this.shopId]
            );
          });

          if (kind === 'product') {
            this.mutable.productPatchesFlushed += entries.length;
          } else {
            this.mutable.variantPatchesFlushed += entries.length;
          }
        } catch (err) {
          this.mutable.flushErrors += 1;
          void insertBulkError({
            shopId: this.shopId,
            bulkRunId: this.bulkRunId,
            errorType: 'metafield_patch_flush_error',
            errorCode: err instanceof Error ? err.message.slice(0, 100) : 'unknown',
            errorMessage: `MetafieldPatchWriter flush failed for ${table} (batch=${entries.length})`,
          }).catch(() => undefined);
        }
      }
    );
  }
}

export class StagingCopyWriter {
  private readonly shopId: string;
  private readonly bulkRunId: string;

  private readonly batchMaxRows: number;
  private readonly batchMaxBytes: number;
  private readonly skipProductStaging: boolean;

  public readonly metafieldPatchWriter: MetafieldPatchWriter;

  private products: StagingProductRowShape[] = [];
  private variants: StagingVariantRowShape[] = [];
  private media: StagingMediaRowShape[] = [];
  private productMedia: StagingProductMediaRowShape[] = [];
  private variantMedia: StagingVariantMediaRowShape[] = [];
  private bufferedBytes = 0;

  private mutable: {
    recordsSeen: number;
    recordsSkipped: number;
    productsCopied: number;
    variantsCopied: number;
    mediaCopied: number;
    productMediaCopied: number;
    variantMediaCopied: number;
  } = {
    recordsSeen: 0,
    recordsSkipped: 0,
    productsCopied: 0,
    variantsCopied: 0,
    mediaCopied: 0,
    productMediaCopied: 0,
    variantMediaCopied: 0,
  };

  constructor(params: {
    shopId: string;
    bulkRunId: string;
    batchMaxRows: number;
    batchMaxBytes: number;
    skipProductStaging?: boolean;
  }) {
    this.shopId = params.shopId;
    this.bulkRunId = params.bulkRunId;
    this.batchMaxRows = Math.max(1, Math.trunc(params.batchMaxRows));
    this.batchMaxBytes = Math.max(1024, Math.trunc(params.batchMaxBytes));
    this.skipProductStaging = params.skipProductStaging === true;
    this.metafieldPatchWriter = new MetafieldPatchWriter({
      shopId: params.shopId,
      bulkRunId: params.bulkRunId,
      batchMaxRows: this.batchMaxRows,
    });
  }

  public getCounters(): CopyWriterCounters {
    const mfCounters = this.metafieldPatchWriter.getCounters();
    return {
      recordsSeen: this.mutable.recordsSeen,
      recordsSkipped: this.mutable.recordsSkipped,
      productsBuffered: this.products.length,
      variantsBuffered: this.variants.length,
      productsCopied: this.mutable.productsCopied,
      variantsCopied: this.mutable.variantsCopied,
      mediaBuffered: this.media.length,
      productMediaBuffered: this.productMedia.length,
      variantMediaBuffered: this.variantMedia.length,
      mediaCopied: this.mutable.mediaCopied,
      productMediaCopied: this.mutable.productMediaCopied,
      variantMediaCopied: this.mutable.variantMediaCopied,
      metafieldProductPatchesBuffered: mfCounters.productPatchesBuffered,
      metafieldVariantPatchesBuffered: mfCounters.variantPatchesBuffered,
      metafieldProductPatchesFlushed: mfCounters.productPatchesFlushed,
      metafieldVariantPatchesFlushed: mfCounters.variantPatchesFlushed,
      metafieldFlushErrors: mfCounters.flushErrors,
    };
  }

  public async handleRecord(record: StitchedRecord): Promise<Readonly<{ flushed: boolean }>> {
    this.mutable.recordsSeen += 1;

    const beforeRows =
      this.products.length +
      this.variants.length +
      this.media.length +
      this.productMedia.length +
      this.variantMedia.length;

    if (record.kind === 'product') {
      if (this.skipProductStaging) {
        this.mutable.recordsSkipped += 1;
        return { flushed: false };
      }
      const row = toStagingProductRowShape(record.raw);
      if (!row?.shopify_gid) {
        this.mutable.recordsSkipped += 1;
        return { flushed: false };
      }
      this.products.push(row);
      this.bufferedBytes += approxBytes(row.raw_data);
      const mediaBatch = extractProductMediaRows(row.shopify_gid, row.raw_data);
      if (mediaBatch.media.length > 0) {
        this.media.push(...mediaBatch.media);
        this.bufferedBytes += approxBytes(mediaBatch.media);
      }
      if (mediaBatch.productMedia.length > 0) {
        this.productMedia.push(...mediaBatch.productMedia);
      }
    } else if (record.kind === 'variant') {
      if (this.skipProductStaging) {
        this.mutable.recordsSkipped += 1;
        return { flushed: false };
      }
      const row = toStagingVariantRowShape(record.raw);
      if (!row?.shopify_gid || !row.product_shopify_gid) {
        this.mutable.recordsSkipped += 1;
        return { flushed: false };
      }
      this.variants.push(row);
      this.bufferedBytes += approxBytes(row.raw_data);
      const variantMediaBatch = extractVariantMediaRows(row.shopify_gid, row.raw_data);
      if (variantMediaBatch.media.length > 0) {
        this.media.push(...variantMediaBatch.media);
        this.bufferedBytes += approxBytes(variantMediaBatch.media);
      }
      if (variantMediaBatch.variantMedia.length > 0) {
        this.variantMedia.push(...variantMediaBatch.variantMedia);
      }
    } else if (record.kind === 'product_metafields_patch') {
      this.metafieldPatchWriter.handleProductPatch(record);
      if (this.metafieldPatchWriter.shouldFlush()) {
        await this.metafieldPatchWriter.flush();
        return { flushed: true };
      }
      return { flushed: false };
    } else if (record.kind === 'variant_metafields_patch') {
      this.metafieldPatchWriter.handleVariantPatch(record);
      if (this.metafieldPatchWriter.shouldFlush()) {
        await this.metafieldPatchWriter.flush();
        return { flushed: true };
      }
      return { flushed: false };
    } else {
      this.mutable.recordsSkipped += 1;
      return { flushed: false };
    }

    const afterRows =
      this.products.length +
      this.variants.length +
      this.media.length +
      this.productMedia.length +
      this.variantMedia.length;
    if (afterRows <= beforeRows) return { flushed: false };

    if (this.shouldFlush()) {
      await this.flush();
      return { flushed: true };
    }

    return { flushed: false };
  }

  public async flush(): Promise<void> {
    const hasStagingRows =
      this.products.length > 0 ||
      this.variants.length > 0 ||
      this.media.length > 0 ||
      this.productMedia.length > 0 ||
      this.variantMedia.length > 0;

    if (!hasStagingRows) {
      // Even with no staging rows, drain any remaining metafield patches
      // (critical for meta runs where skipProductStaging === true).
      await this.metafieldPatchWriter.flush();
      return;
    }

    // Flush products first.
    if (this.products.length > 0) {
      const batch = this.products;
      this.products = [];
      await this.copyProducts(batch);
      this.mutable.productsCopied += batch.length;
    }

    if (this.variants.length > 0) {
      const batch = this.variants;
      this.variants = [];
      await this.copyVariants(batch);
      this.mutable.variantsCopied += batch.length;
    }

    if (this.media.length > 0) {
      const batch = this.media;
      this.media = [];
      await this.copyMedia(batch);
      this.mutable.mediaCopied += batch.length;
    }

    if (this.productMedia.length > 0) {
      const batch = this.productMedia;
      this.productMedia = [];
      await this.copyProductMedia(batch);
      this.mutable.productMediaCopied += batch.length;
    }

    if (this.variantMedia.length > 0) {
      const batch = this.variantMedia;
      this.variantMedia = [];
      await this.copyVariantMedia(batch);
      this.mutable.variantMediaCopied += batch.length;
    }

    await this.metafieldPatchWriter.flush();

    this.bufferedBytes = 0;
  }

  private shouldFlush(): boolean {
    const rows =
      this.products.length +
      this.variants.length +
      this.media.length +
      this.productMedia.length +
      this.variantMedia.length;
    return rows >= this.batchMaxRows || this.bufferedBytes >= this.batchMaxBytes;
  }

  private async insertRows(params: {
    table: string;
    columns: readonly string[];
    rows: readonly (readonly unknown[])[];
  }): Promise<void> {
    if (params.rows.length === 0) return;
    const columnCount = params.columns.length;
    // Keep bind parameter count comfortably below protocol/driver limits.
    const maxParamsPerQuery = 10_000;
    const rowsPerChunk = Math.max(1, Math.floor(maxParamsPerQuery / columnCount));

    await withTenantContext(this.shopId, async (client) => {
      for (let start = 0; start < params.rows.length; start += rowsPerChunk) {
        const chunk = params.rows.slice(start, start + rowsPerChunk);
        const values: unknown[] = [];
        const tuples = chunk.map((row, rowIdx) => {
          const placeholders = row.map((value, colIdx) => {
            values.push(value);
            return `$${rowIdx * columnCount + colIdx + 1}`;
          });
          return `(${placeholders.join(', ')})`;
        });
        const sql = `INSERT INTO ${params.table} (${params.columns.join(', ')}) VALUES ${tuples.join(', ')}`;
        await client.query(sql, values);
      }
    });
  }

  private async copyProducts(rows: readonly StagingProductRowShape[]): Promise<void> {
    await withBulkSpan(
      'bulk.copy.batch',
      {
        shopId: this.shopId,
        bulkRunId: this.bulkRunId,
        step: 'copy',
      },
      async (span) => {
        span.setAttribute('bulk.copy_kind', 'products');
        span.setAttribute('bulk.batch_rows', rows.length);

        const tuples = rows.map((row) => {
          const legacy = extractLegacyResourceId(row.shopify_gid);
          const title = row.title;
          const handle = row.handle;
          const status = row.status;
          // If required fields are missing, stage as invalid for later inspection.
          const isValid = Boolean(legacy && title && handle && status);
          return [
            this.bulkRunId,
            this.shopId,
            row.shopify_gid,
            legacy,
            title,
            handle,
            row.description,
            row.description_html,
            row.vendor,
            row.product_type,
            status,
            row.tags,
            asJsonColumn(row.options),
            asJsonColumn(row.seo),
            row.featured_image_url,
            asJsonColumn(row.price_range),
            asJsonColumn(row.compare_at_price_range),
            row.published_at,
            row.template_suffix,
            row.has_only_default_variant,
            row.total_inventory,
            asJsonColumn(row.collections),
            row.category_id ?? null,
            asJsonColumn(row.raw_data),
            isValid ? 'valid' : 'invalid',
            'pending',
          ] as const;
        });
        await this.insertRows({
          table: 'staging_products',
          columns: [
            'bulk_run_id',
            'shop_id',
            'shopify_gid',
            'legacy_resource_id',
            'title',
            'handle',
            'description',
            'description_html',
            'vendor',
            'product_type',
            'status',
            'tags',
            'options',
            'seo',
            'featured_image_url',
            'price_range',
            'compare_at_price_range',
            'published_at',
            'template_suffix',
            'has_only_default_variant',
            'total_inventory',
            'collections',
            'category_id',
            'raw_data',
            'validation_status',
            'merge_status',
          ],
          rows: tuples,
        });
      }
    );
  }

  private async copyVariants(rows: readonly StagingVariantRowShape[]): Promise<void> {
    await withBulkSpan(
      'bulk.copy.batch',
      {
        shopId: this.shopId,
        bulkRunId: this.bulkRunId,
        step: 'copy',
      },
      async (span) => {
        span.setAttribute('bulk.copy_kind', 'variants');
        span.setAttribute('bulk.batch_rows', rows.length);

        const tuples = rows.map((row) => {
          const legacy = extractLegacyResourceId(row.shopify_gid);
          const title = row.title;
          const price = row.price;
          const compareAt = row.compare_at_price ?? row.price;
          const isValid = Boolean(legacy && title && price);
          return [
            this.bulkRunId,
            this.shopId,
            row.shopify_gid,
            legacy,
            title,
            row.sku,
            row.barcode,
            price,
            compareAt,
            row.inventory_quantity,
            row.inventory_item_id,
            asJsonColumn(row.selected_options),
            row.image_url,
            asJsonColumn(row.raw_data),
            isValid ? 'valid' : 'invalid',
            'pending',
          ] as const;
        });
        await this.insertRows({
          table: 'staging_variants',
          columns: [
            'bulk_run_id',
            'shop_id',
            'shopify_gid',
            'legacy_resource_id',
            'title',
            'sku',
            'barcode',
            'price',
            'compare_at_price',
            'inventory_quantity',
            'inventory_item_id',
            'selected_options',
            'image_url',
            'raw_data',
            'validation_status',
            'merge_status',
          ],
          rows: tuples,
        });
      }
    );
  }

  private async copyMedia(rows: readonly StagingMediaRowShape[]): Promise<void> {
    await withBulkSpan(
      'bulk.copy.batch',
      {
        shopId: this.shopId,
        bulkRunId: this.bulkRunId,
        step: 'copy',
      },
      async (span) => {
        span.setAttribute('bulk.copy_kind', 'media');
        span.setAttribute('bulk.batch_rows', rows.length);

        const tuples = rows.map((row) => {
          const isValid = Boolean(row.shopify_gid && row.media_type);
          return [
            this.bulkRunId,
            this.shopId,
            row.shopify_gid,
            row.legacy_resource_id,
            row.media_type,
            row.alt,
            row.status,
            row.mime_type,
            row.file_size,
            row.width,
            row.height,
            row.duration,
            row.url,
            row.preview_url,
            asJsonColumn(row.sources),
            asJsonColumn(row.metadata),
            asJsonColumn(row.raw_data),
            isValid ? 'valid' : 'invalid',
            'pending',
          ] as const;
        });
        await this.insertRows({
          table: 'staging_media',
          columns: [
            'bulk_run_id',
            'shop_id',
            'shopify_gid',
            'legacy_resource_id',
            'media_type',
            'alt',
            'status',
            'mime_type',
            'file_size',
            'width',
            'height',
            'duration',
            'url',
            'preview_url',
            'sources',
            'metadata',
            'raw_data',
            'validation_status',
            'merge_status',
          ],
          rows: tuples,
        });
      }
    );
  }

  private async copyProductMedia(rows: readonly StagingProductMediaRowShape[]): Promise<void> {
    await withBulkSpan(
      'bulk.copy.batch',
      {
        shopId: this.shopId,
        bulkRunId: this.bulkRunId,
        step: 'copy',
      },
      async (span) => {
        span.setAttribute('bulk.copy_kind', 'product_media');
        span.setAttribute('bulk.batch_rows', rows.length);

        const tuples = rows.map((row) => {
          const isValid = Boolean(row.product_shopify_gid && row.media_shopify_gid);
          return [
            this.bulkRunId,
            this.shopId,
            row.product_shopify_gid,
            row.media_shopify_gid,
            row.position,
            row.is_featured,
            isValid ? 'valid' : 'invalid',
            'pending',
          ] as const;
        });
        await this.insertRows({
          table: 'staging_product_media',
          columns: [
            'bulk_run_id',
            'shop_id',
            'product_shopify_gid',
            'media_shopify_gid',
            'position',
            'is_featured',
            'validation_status',
            'merge_status',
          ],
          rows: tuples,
        });
      }
    );
  }

  private async copyVariantMedia(rows: readonly StagingVariantMediaRowShape[]): Promise<void> {
    await withBulkSpan(
      'bulk.copy.batch',
      {
        shopId: this.shopId,
        bulkRunId: this.bulkRunId,
        step: 'copy',
      },
      async (span) => {
        span.setAttribute('bulk.copy_kind', 'variant_media');
        span.setAttribute('bulk.batch_rows', rows.length);

        const tuples = rows.map((row) => {
          const isValid = Boolean(row.variant_shopify_gid && row.media_shopify_gid);
          return [
            this.bulkRunId,
            this.shopId,
            row.variant_shopify_gid,
            row.media_shopify_gid,
            row.position,
            isValid ? 'valid' : 'invalid',
            'pending',
          ] as const;
        });
        await this.insertRows({
          table: 'staging_variant_media',
          columns: [
            'bulk_run_id',
            'shop_id',
            'variant_shopify_gid',
            'media_shopify_gid',
            'position',
            'validation_status',
            'merge_status',
          ],
          rows: tuples,
        });
      }
    );
  }
}

function approxBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}

function asJsonColumn(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractImageNode(node: Record<string, unknown>): {
  id: string;
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
} | null {
  const id = asString(node['id']);
  const url = asString(node['url']);
  if (!id || !url) return null;
  return {
    id,
    url,
    altText: asString(node['altText']),
    width: asNumber(node['width']),
    height: asNumber(node['height']),
  };
}

function extractMediaRowsFromImage(
  image: {
    id: string;
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
  },
  raw: unknown
): StagingMediaRowShape {
  return {
    shopify_gid: image.id,
    legacy_resource_id: extractLegacyResourceId(image.id),
    media_type: 'IMAGE',
    alt: image.altText,
    status: 'READY',
    mime_type: null,
    file_size: null,
    width: image.width,
    height: image.height,
    duration: null,
    url: image.url,
    preview_url: image.url,
    sources: [],
    metadata: {},
    raw_data: raw,
  };
}

function extractProductMediaRows(
  productShopifyGid: string,
  raw: unknown
): { media: StagingMediaRowShape[]; productMedia: StagingProductMediaRowShape[] } {
  const o = raw as Record<string, unknown>;
  const mediaRows: StagingMediaRowShape[] = [];
  const productMediaRows: StagingProductMediaRowShape[] = [];
  const seen = new Set<string>();
  let position = 0;

  const featuredImage = o['featuredImage'];
  if (featuredImage && typeof featuredImage === 'object') {
    const image = extractImageNode(featuredImage as Record<string, unknown>);
    if (image && !seen.has(image.id)) {
      seen.add(image.id);
      mediaRows.push(extractMediaRowsFromImage(image, featuredImage));
      productMediaRows.push({
        product_shopify_gid: productShopifyGid,
        media_shopify_gid: image.id,
        position,
        is_featured: true,
      });
      position += 1;
    }
  }

  const images = o['images'];
  if (images && typeof images === 'object') {
    const nodes = (images as Record<string, unknown>)['nodes'];
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const image = extractImageNode(node as Record<string, unknown>);
        if (!image || seen.has(image.id)) continue;
        seen.add(image.id);
        mediaRows.push(extractMediaRowsFromImage(image, node));
        productMediaRows.push({
          product_shopify_gid: productShopifyGid,
          media_shopify_gid: image.id,
          position,
          is_featured: false,
        });
        position += 1;
      }
    }
  }

  const media = o['media'];
  if (media && typeof media === 'object') {
    const nodes = (media as Record<string, unknown>)['nodes'];
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const rec = node as Record<string, unknown>;
        const id = asString(rec['id']);
        const typename = asString(rec['__typename']);
        if (!id || !typename || seen.has(id)) continue;
        let mediaType: StagingMediaRowShape['media_type'] | null = null;
        let url: string | null = null;
        let previewUrl: string | null = null;
        let alt: string | null = null;
        let width: number | null = null;
        let height: number | null = null;
        let sources: unknown = [];

        if (typename === 'MediaImage') {
          const image = rec['image'];
          if (image && typeof image === 'object') {
            const parsed = extractImageNode(image as Record<string, unknown>);
            if (parsed) {
              mediaType = 'IMAGE';
              url = parsed.url;
              previewUrl = parsed.url;
              alt = parsed.altText;
              width = parsed.width;
              height = parsed.height;
              sources = [];
            }
          }
        } else if (typename === 'Video') {
          mediaType = 'VIDEO';
          const srcs = rec['sources'];
          if (Array.isArray(srcs) && srcs[0] && typeof srcs[0] === 'object') {
            url = asString((srcs[0] as Record<string, unknown>)['url']);
          }
          sources = Array.isArray(srcs) ? srcs : [];
        } else if (typename === 'ExternalVideo') {
          mediaType = 'EXTERNAL_VIDEO';
          url = asString(rec['embeddedUrl']);
          sources = [];
        } else if (typename === 'Model3d') {
          mediaType = 'MODEL_3D';
          const srcs = rec['sources'];
          if (Array.isArray(srcs) && srcs[0] && typeof srcs[0] === 'object') {
            url = asString((srcs[0] as Record<string, unknown>)['url']);
          }
          sources = Array.isArray(srcs) ? srcs : [];
        }

        if (!mediaType) continue;
        seen.add(id);
        mediaRows.push({
          shopify_gid: id,
          legacy_resource_id: extractLegacyResourceId(id),
          media_type: mediaType,
          alt,
          status: 'READY',
          mime_type: null,
          file_size: null,
          width,
          height,
          duration: null,
          url,
          preview_url: previewUrl ?? url,
          sources,
          metadata: {},
          raw_data: rec,
        });
        productMediaRows.push({
          product_shopify_gid: productShopifyGid,
          media_shopify_gid: id,
          position,
          is_featured: false,
        });
        position += 1;
      }
    }
  }

  return { media: mediaRows, productMedia: productMediaRows };
}

function extractVariantMediaRows(
  variantShopifyGid: string,
  raw: unknown
): { media: StagingMediaRowShape[]; variantMedia: StagingVariantMediaRowShape[] } {
  const o = raw as Record<string, unknown>;
  const mediaRows: StagingMediaRowShape[] = [];
  const variantMediaRows: StagingVariantMediaRowShape[] = [];

  const image = o['image'];
  if (image && typeof image === 'object') {
    const parsed = extractImageNode(image as Record<string, unknown>);
    if (parsed) {
      mediaRows.push(extractMediaRowsFromImage(parsed, image));
      variantMediaRows.push({
        variant_shopify_gid: variantShopifyGid,
        media_shopify_gid: parsed.id,
        position: 0,
      });
    }
  }

  return { media: mediaRows, variantMedia: variantMediaRows };
}
