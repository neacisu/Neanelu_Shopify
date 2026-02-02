import { PgCopyStreamsManager } from '@app/database';

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

function encodeCopyText(value: string): string {
  // COPY text format escaping for tab/newline/carriage return/backslash.
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function encodeCopyNullable(value: string | null | undefined): string {
  if (value == null) return '\\N';
  return encodeCopyText(value);
}

function encodeCopyNullableJson(value: unknown): string {
  if (value == null) return '\\N';
  return encodeCopyText(JSON.stringify(value));
}

function encodeTextArray(values: readonly string[]): string {
  // Postgres array literal: {"a","b"}
  const escaped = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${escaped.join(',')}}`;
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

export class StagingCopyWriter {
  private readonly copyManager: PgCopyStreamsManager;
  private readonly shopId: string;
  private readonly bulkRunId: string;

  private readonly batchMaxRows: number;
  private readonly batchMaxBytes: number;

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
    copyManager?: PgCopyStreamsManager;
    batchMaxRows: number;
    batchMaxBytes: number;
  }) {
    this.shopId = params.shopId;
    this.bulkRunId = params.bulkRunId;
    this.copyManager = params.copyManager ?? new PgCopyStreamsManager();
    this.batchMaxRows = Math.max(1, Math.trunc(params.batchMaxRows));
    this.batchMaxBytes = Math.max(1024, Math.trunc(params.batchMaxBytes));
  }

  public getCounters(): CopyWriterCounters {
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
    } else {
      // PR-042 scope: only stage products/variants. Others are handled by later PRs.
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
    if (
      this.products.length === 0 &&
      this.variants.length === 0 &&
      this.media.length === 0 &&
      this.productMedia.length === 0 &&
      this.variantMedia.length === 0
    )
      return;

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

        const cmd = {
          sql: `COPY staging_products (
                  bulk_run_id,
                  shop_id,
                  shopify_gid,
                  legacy_resource_id,
                  title,
                  handle,
                  description,
                  description_html,
                  vendor,
                  product_type,
                  status,
                  tags,
                  options,
                  seo,
                  featured_image_url,
                  price_range,
                  compare_at_price_range,
                  published_at,
                  template_suffix,
                  has_only_default_variant,
                  total_inventory,
                  collections,
                  raw_data,
                  validation_status,
                  merge_status
                ) FROM STDIN WITH (FORMAT text)`,
        };

        await this.copyManager.withCopyFrom({
          shopId: this.shopId,
          command: cmd,
          write: async (stream) => {
            for (const row of rows) {
              const legacy = extractLegacyResourceId(row.shopify_gid);
              const title = row.title;
              const handle = row.handle;
              const status = row.status;

              // If required fields are missing, stage as invalid for later inspection.
              const isValid = Boolean(legacy && title && handle && status);

              const line = [
                this.bulkRunId,
                this.shopId,
                row.shopify_gid,
                legacy != null ? String(legacy) : '\\N',
                encodeCopyNullable(title),
                encodeCopyNullable(handle),
                encodeCopyNullable(row.description),
                encodeCopyNullable(row.description_html),
                encodeCopyNullable(row.vendor),
                encodeCopyNullable(row.product_type),
                encodeCopyNullable(status),
                row.tags.length > 0
                  ? encodeCopyText(encodeTextArray(row.tags))
                  : encodeCopyText('{}'),
                encodeCopyNullableJson(row.options),
                encodeCopyNullableJson(row.seo),
                encodeCopyNullable(row.featured_image_url),
                encodeCopyNullableJson(row.price_range),
                encodeCopyNullableJson(row.compare_at_price_range),
                encodeCopyNullable(row.published_at),
                encodeCopyNullable(row.template_suffix),
                row.has_only_default_variant != null ? String(row.has_only_default_variant) : '\\N',
                row.total_inventory != null ? String(row.total_inventory) : '\\N',
                encodeCopyNullableJson(row.collections),
                encodeCopyNullableJson(row.raw_data),
                isValid ? 'valid' : 'invalid',
                'pending',
              ].join('\t');

              if (!stream.write(`${line}\n`)) {
                await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
              }
            }

            stream.end();
          },
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

        const cmd = {
          sql: `COPY staging_variants (
                  bulk_run_id,
                  shop_id,
                  shopify_gid,
                  legacy_resource_id,
                  title,
                  sku,
                  barcode,
                  price,
                  compare_at_price,
                  inventory_quantity,
                  inventory_item_id,
                  selected_options,
                  image_url,
                  raw_data,
                  validation_status,
                  merge_status
                ) FROM STDIN WITH (FORMAT text)`,
        };

        await this.copyManager.withCopyFrom({
          shopId: this.shopId,
          command: cmd,
          write: async (stream) => {
            for (const row of rows) {
              const legacy = extractLegacyResourceId(row.shopify_gid);
              const title = row.title;
              const price = row.price;

              const compareAt = row.compare_at_price ?? row.price;
              const isValid = Boolean(legacy && title && price);

              const line = [
                this.bulkRunId,
                this.shopId,
                row.shopify_gid,
                legacy != null ? String(legacy) : '\\N',
                encodeCopyNullable(title),
                encodeCopyNullable(row.sku),
                encodeCopyNullable(row.barcode),
                encodeCopyNullable(price),
                encodeCopyNullable(compareAt),
                row.inventory_quantity != null ? String(row.inventory_quantity) : '\\N',
                encodeCopyNullable(row.inventory_item_id),
                encodeCopyNullableJson(row.selected_options),
                encodeCopyNullable(row.image_url),
                encodeCopyNullableJson(row.raw_data),
                isValid ? 'valid' : 'invalid',
                'pending',
              ].join('\t');

              if (!stream.write(`${line}\n`)) {
                await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
              }
            }

            stream.end();
          },
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

        const cmd = {
          sql: `COPY staging_media (
                  bulk_run_id,
                  shop_id,
                  shopify_gid,
                  legacy_resource_id,
                  media_type,
                  alt,
                  status,
                  mime_type,
                  file_size,
                  width,
                  height,
                  duration,
                  url,
                  preview_url,
                  sources,
                  metadata,
                  raw_data,
                  validation_status,
                  merge_status
                ) FROM STDIN WITH (FORMAT text)`,
        };

        await this.copyManager.withCopyFrom({
          shopId: this.shopId,
          command: cmd,
          write: async (stream) => {
            for (const row of rows) {
              const legacy = row.legacy_resource_id;
              const isValid = Boolean(row.shopify_gid && row.media_type);
              const line = [
                this.bulkRunId,
                this.shopId,
                row.shopify_gid,
                legacy != null ? String(legacy) : '\\N',
                encodeCopyNullable(row.media_type),
                encodeCopyNullable(row.alt),
                encodeCopyNullable(row.status),
                encodeCopyNullable(row.mime_type),
                row.file_size != null ? String(row.file_size) : '\\N',
                row.width != null ? String(row.width) : '\\N',
                row.height != null ? String(row.height) : '\\N',
                row.duration != null ? String(row.duration) : '\\N',
                encodeCopyNullable(row.url),
                encodeCopyNullable(row.preview_url),
                encodeCopyNullableJson(row.sources),
                encodeCopyNullableJson(row.metadata),
                encodeCopyNullableJson(row.raw_data),
                isValid ? 'valid' : 'invalid',
                'pending',
              ].join('\t');

              if (!stream.write(`${line}\n`)) {
                await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
              }
            }

            stream.end();
          },
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

        const cmd = {
          sql: `COPY staging_product_media (
                  bulk_run_id,
                  shop_id,
                  product_shopify_gid,
                  media_shopify_gid,
                  position,
                  is_featured,
                  validation_status,
                  merge_status
                ) FROM STDIN WITH (FORMAT text)`,
        };

        await this.copyManager.withCopyFrom({
          shopId: this.shopId,
          command: cmd,
          write: async (stream) => {
            for (const row of rows) {
              const isValid = Boolean(row.product_shopify_gid && row.media_shopify_gid);
              const line = [
                this.bulkRunId,
                this.shopId,
                row.product_shopify_gid,
                row.media_shopify_gid,
                String(row.position),
                row.is_featured ? 'true' : 'false',
                isValid ? 'valid' : 'invalid',
                'pending',
              ].join('\t');

              if (!stream.write(`${line}\n`)) {
                await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
              }
            }

            stream.end();
          },
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

        const cmd = {
          sql: `COPY staging_variant_media (
                  bulk_run_id,
                  shop_id,
                  variant_shopify_gid,
                  media_shopify_gid,
                  position,
                  validation_status,
                  merge_status
                ) FROM STDIN WITH (FORMAT text)`,
        };

        await this.copyManager.withCopyFrom({
          shopId: this.shopId,
          command: cmd,
          write: async (stream) => {
            for (const row of rows) {
              const isValid = Boolean(row.variant_shopify_gid && row.media_shopify_gid);
              const line = [
                this.bulkRunId,
                this.shopId,
                row.variant_shopify_gid,
                row.media_shopify_gid,
                String(row.position),
                isValid ? 'valid' : 'invalid',
                'pending',
              ].join('\t');

              if (!stream.write(`${line}\n`)) {
                await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
              }
            }

            stream.end();
          },
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

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractImageNode(
  node: Record<string, unknown>
): {
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
