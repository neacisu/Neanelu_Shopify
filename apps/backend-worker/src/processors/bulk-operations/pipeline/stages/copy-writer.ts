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
}>;

export class StagingCopyWriter {
  private readonly copyManager: PgCopyStreamsManager;
  private readonly shopId: string;
  private readonly bulkRunId: string;

  private readonly batchMaxRows: number;
  private readonly batchMaxBytes: number;

  private products: StagingProductRowShape[] = [];
  private variants: StagingVariantRowShape[] = [];
  private bufferedBytes = 0;

  private mutable: {
    recordsSeen: number;
    recordsSkipped: number;
    productsCopied: number;
    variantsCopied: number;
  } = {
    recordsSeen: 0,
    recordsSkipped: 0,
    productsCopied: 0,
    variantsCopied: 0,
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
    };
  }

  public async handleRecord(record: StitchedRecord): Promise<Readonly<{ flushed: boolean }>> {
    this.mutable.recordsSeen += 1;

    const beforeRows = this.products.length + this.variants.length;

    if (record.kind === 'product') {
      const row = toStagingProductRowShape(record.raw);
      if (!row?.shopify_gid) {
        this.mutable.recordsSkipped += 1;
        return { flushed: false };
      }
      this.products.push(row);
      this.bufferedBytes += approxBytes(row.raw_data);
    } else if (record.kind === 'variant') {
      const row = toStagingVariantRowShape(record.raw);
      if (!row?.shopify_gid || !row.product_shopify_gid) {
        this.mutable.recordsSkipped += 1;
        return { flushed: false };
      }
      this.variants.push(row);
      this.bufferedBytes += approxBytes(row.raw_data);
    } else {
      // PR-042 scope: only stage products/variants. Others are handled by later PRs.
      this.mutable.recordsSkipped += 1;
      return { flushed: false };
    }

    const afterRows = this.products.length + this.variants.length;
    if (afterRows <= beforeRows) return { flushed: false };

    if (this.shouldFlush()) {
      await this.flush();
      return { flushed: true };
    }

    return { flushed: false };
  }

  public async flush(): Promise<void> {
    if (this.products.length === 0 && this.variants.length === 0) return;

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

    this.bufferedBytes = 0;
  }

  private shouldFlush(): boolean {
    const rows = this.products.length + this.variants.length;
    return rows >= this.batchMaxRows || this.bufferedBytes >= this.batchMaxBytes;
  }

  private async copyProducts(rows: readonly StagingProductRowShape[]): Promise<void> {
    const cmd = {
      sql: `COPY staging_products (
              bulk_run_id,
              shop_id,
              shopify_gid,
              legacy_resource_id,
              title,
              handle,
              vendor,
              product_type,
              status,
              tags,
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
            encodeCopyNullable(row.vendor),
            encodeCopyNullable(row.product_type),
            encodeCopyNullable(status),
            row.tags.length > 0 ? encodeCopyText(encodeTextArray(row.tags)) : encodeCopyText('{}'),
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

  private async copyVariants(rows: readonly StagingVariantRowShape[]): Promise<void> {
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
}

function approxBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}
