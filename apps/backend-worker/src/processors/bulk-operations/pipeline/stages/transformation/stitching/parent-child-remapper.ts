import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';

import { OTEL_ATTR, type Logger } from '@app/logger';

import type { MinimalBulkJsonlObject } from '../../../types.js';

export type StitchingCounters = Readonly<{
  productsSeen: number;
  variantsSeen: number;
  variantsEmitted: number;
  variantsBufferedInMemory: number;
  variantsSpilledToDisk: number;
  variantsQuarantined: number;
  metafieldsSeen: number;
  metafieldsEmitted: number;
  metafieldsSpilledToDisk: number;
  metafieldsQuarantined: number;
  inventoryItemsSeen: number;
  inventoryLevelsSeen: number;
  inventoryLevelsEmitted: number;
  inventoryLevelsSpilledToDisk: number;
  inventoryLevelsQuarantined: number;
}>;

export type StitchedRecord =
  | Readonly<{
      kind: 'product';
      id: string;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'inventory_item';
      id: string;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'variant';
      id: string;
      productId: string;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'product_metafields_patch';
      ownerId: string;
      namespace: string;
      key: string;
      value: unknown;
      patch: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'variant_metafields_patch';
      ownerId: string;
      namespace: string;
      key: string;
      value: unknown;
      patch: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'inventory_level';
      id: string;
      inventoryItemId: string;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'quarantine_orphan_variant';
      id: string;
      missingParentId: string;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'quarantine_orphan_metafield';
      id: string;
      missingParentId: string;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'quarantine_orphan_inventory_level';
      id: string;
      missingParentId: string;
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'quarantine_invalid_metafield';
      id: string;
      reason: 'missing_owner_id' | 'missing_namespace_key' | 'missing_id';
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'quarantine_invalid_inventory_level';
      id: string;
      reason: 'missing_parent_id' | 'missing_id';
      raw: MinimalBulkJsonlObject;
    }>
  | Readonly<{
      kind: 'quarantine_invalid_variant';
      id: string;
      reason: 'missing_parent_id' | 'missing_id';
      raw: MinimalBulkJsonlObject;
    }>;

type JsonlLine = MinimalBulkJsonlObject & {
  id?: unknown;
  __typename?: unknown;
  __parentId?: unknown;
  product?: unknown;
};

type SpillVariantEnvelope = Readonly<{
  __typename: 'ProductVariant';
  id: string;
  parentId: string;
  raw: MinimalBulkJsonlObject;
}>;

type SpillMetafieldEnvelope = Readonly<{
  __typename: 'Metafield';
  id: string;
  ownerId: string;
  ownerTypename: 'Product' | 'ProductVariant' | 'Unknown';
  namespace: string;
  key: string;
  value: unknown;
  raw: MinimalBulkJsonlObject;
}>;

type SpillInventoryLevelEnvelope = Readonly<{
  __typename: 'InventoryLevel';
  id: string;
  inventoryItemId: string;
  raw: MinimalBulkJsonlObject;
}>;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractId(obj: JsonlLine): string | null {
  return asString(obj.id);
}

function extractTypename(obj: JsonlLine): string | null {
  return asString(obj.__typename);
}

function extractVariantParentId(obj: JsonlLine): string | null {
  // Prefer explicit product.id if present, then Shopify bulk __parentId.
  // (Plan requires both logical + JSONL projection contracts.)
  const product = obj.product;
  if (product && typeof product === 'object') {
    const pid = asString((product as Record<string, unknown>)['id']);
    if (pid) return pid;
  }
  return asString(obj.__parentId);
}

function extractMetafieldOwner(
  obj: JsonlLine
): { ownerId: string; ownerTypename: 'Product' | 'ProductVariant' | 'Unknown' } | null {
  const owner = (obj as Record<string, unknown>)['owner'];
  if (owner && typeof owner === 'object') {
    const o = owner as Record<string, unknown>;
    const id = asString(o['id']);
    const tn = asString(o['__typename']);
    if (id) {
      if (tn === 'Product') return { ownerId: id, ownerTypename: 'Product' };
      if (tn === 'ProductVariant') return { ownerId: id, ownerTypename: 'ProductVariant' };
      return { ownerId: id, ownerTypename: 'Unknown' };
    }
  }

  const parentId = asString(obj.__parentId);
  if (parentId) return { ownerId: parentId, ownerTypename: 'Unknown' };

  return null;
}

function extractMetafieldNamespaceKey(obj: JsonlLine): { namespace: string; key: string } | null {
  const ns = asString((obj as Record<string, unknown>)['namespace']);
  const key = asString((obj as Record<string, unknown>)['key']);
  if (!ns || !key) return null;
  return { namespace: ns, key };
}

function extractMetafieldValue(obj: JsonlLine): unknown {
  const jsonValue = (obj as Record<string, unknown>)['jsonValue'];
  if (jsonValue !== undefined) {
    if (typeof jsonValue === 'string') {
      const trimmed = jsonValue.trim();
      // Shopify returns jsonValue as a JSON-encoded scalar/structure.
      // Parse best-effort, but fall back to raw string to keep streaming tolerant.
      try {
        return JSON.parse(trimmed);
      } catch {
        return jsonValue;
      }
    }
    return jsonValue;
  }
  return (obj as Record<string, unknown>)['value'];
}

function hashToBucket(input: string, bucketCount: number): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % bucketCount;
}

export class ParentChildRemapper {
  private readonly parentsDir: string;
  private readonly orphansDir: string;
  private readonly quarantineDir: string;
  private readonly bucketCount: number;
  private readonly maxInMemoryParents: number;
  private readonly maxInMemoryOrphans: number;

  private readonly recentParents = new Map<string, true>();
  private recentParentsOrder: string[] = [];
  private readonly inMemoryOrphansByParentId = new Map<string, SpillVariantEnvelope[]>();
  private inMemoryOrphansCount = 0;

  private countersMutable: {
    productsSeen: number;
    variantsSeen: number;
    variantsEmitted: number;
    variantsBufferedInMemory: number;
    variantsSpilledToDisk: number;
    variantsQuarantined: number;
    metafieldsSeen: number;
    metafieldsEmitted: number;
    metafieldsSpilledToDisk: number;
    metafieldsQuarantined: number;
    inventoryItemsSeen: number;
    inventoryLevelsSeen: number;
    inventoryLevelsEmitted: number;
    inventoryLevelsSpilledToDisk: number;
    inventoryLevelsQuarantined: number;
  };

  public constructor(
    private readonly params: {
      shopId: string;
      artifactsDir: string;
      logger: Logger;
      onRecord: (record: StitchedRecord) => Promise<void> | void;
      bucketCount?: number;
      maxInMemoryParents?: number;
      maxInMemoryOrphans?: number;
    }
  ) {
    this.bucketCount = Math.max(8, Math.floor(params.bucketCount ?? 256));
    this.maxInMemoryParents = Math.max(1, Math.floor(params.maxInMemoryParents ?? 50_000));
    this.maxInMemoryOrphans = Math.max(1, Math.floor(params.maxInMemoryOrphans ?? 50_000));

    this.parentsDir = path.join(params.artifactsDir, 'stitching', 'parents');
    this.orphansDir = path.join(params.artifactsDir, 'stitching', 'orphans');
    this.quarantineDir = path.join(params.artifactsDir, 'stitching', 'quarantine');

    this.countersMutable = {
      productsSeen: 0,
      variantsSeen: 0,
      variantsEmitted: 0,
      variantsBufferedInMemory: 0,
      variantsSpilledToDisk: 0,
      variantsQuarantined: 0,
      metafieldsSeen: 0,
      metafieldsEmitted: 0,
      metafieldsSpilledToDisk: 0,
      metafieldsQuarantined: 0,
      inventoryItemsSeen: 0,
      inventoryLevelsSeen: 0,
      inventoryLevelsEmitted: 0,
      inventoryLevelsSpilledToDisk: 0,
      inventoryLevelsQuarantined: 0,
    };
  }

  public async init(): Promise<void> {
    await mkdir(this.parentsDir, { recursive: true });
    await mkdir(this.orphansDir, { recursive: true });
    await mkdir(this.quarantineDir, { recursive: true });
  }

  public getCounters(): StitchingCounters {
    const c = this.countersMutable;
    return {
      productsSeen: c.productsSeen,
      variantsSeen: c.variantsSeen,
      variantsEmitted: c.variantsEmitted,
      variantsBufferedInMemory: c.variantsBufferedInMemory,
      variantsSpilledToDisk: c.variantsSpilledToDisk,
      variantsQuarantined: c.variantsQuarantined,
      metafieldsSeen: c.metafieldsSeen,
      metafieldsEmitted: c.metafieldsEmitted,
      metafieldsSpilledToDisk: c.metafieldsSpilledToDisk,
      metafieldsQuarantined: c.metafieldsQuarantined,
      inventoryItemsSeen: c.inventoryItemsSeen,
      inventoryLevelsSeen: c.inventoryLevelsSeen,
      inventoryLevelsEmitted: c.inventoryLevelsEmitted,
      inventoryLevelsSpilledToDisk: c.inventoryLevelsSpilledToDisk,
      inventoryLevelsQuarantined: c.inventoryLevelsQuarantined,
    };
  }

  public async processLine(obj: MinimalBulkJsonlObject): Promise<void> {
    const line = obj as JsonlLine;
    const typename = extractTypename(line);

    if (typename === 'Product') {
      const id = extractId(line);
      if (!id) return;
      this.countersMutable.productsSeen += 1;
      await this.recordParentId(id);
      await this.params.onRecord({ kind: 'product', id, raw: obj });

      const buffered = this.inMemoryOrphansByParentId.get(id);
      if (buffered && buffered.length > 0) {
        for (const v of buffered) {
          await this.emitVariant(v);
        }
        this.inMemoryOrphansByParentId.delete(id);
        this.inMemoryOrphansCount -= buffered.length;
      }
      return;
    }

    if (typename === 'InventoryItem') {
      const id = extractId(line);
      if (!id) return;
      this.countersMutable.inventoryItemsSeen += 1;
      await this.recordParentId(id);
      await this.params.onRecord({ kind: 'inventory_item', id, raw: obj });
      return;
    }

    if (typename === 'ProductVariant') {
      this.countersMutable.variantsSeen += 1;
      const id = extractId(line);
      if (!id) {
        await this.params.onRecord({
          kind: 'quarantine_invalid_variant',
          id: '',
          reason: 'missing_id',
          raw: obj,
        });
        this.countersMutable.variantsQuarantined += 1;
        return;
      }

      const parentId = extractVariantParentId(line);
      if (!parentId) {
        await this.params.onRecord({
          kind: 'quarantine_invalid_variant',
          id,
          reason: 'missing_parent_id',
          raw: obj,
        });
        this.countersMutable.variantsQuarantined += 1;
        return;
      }

      const env: SpillVariantEnvelope = {
        __typename: 'ProductVariant',
        id,
        parentId,
        raw: obj,
      };

      // Fast-path: if we've seen the parent recently, emit immediately.
      if (this.recentParents.has(parentId)) {
        await this.emitVariant(env);
        return;
      }

      // Buffer in memory up to threshold; beyond that, spill to disk.
      if (this.inMemoryOrphansCount < this.maxInMemoryOrphans) {
        const existing = this.inMemoryOrphansByParentId.get(parentId) ?? [];
        existing.push(env);
        this.inMemoryOrphansByParentId.set(parentId, existing);
        this.inMemoryOrphansCount += 1;
        this.countersMutable.variantsBufferedInMemory += 1;
        return;
      }

      await this.spillOrphanVariant(env);
      this.countersMutable.variantsSpilledToDisk += 1;
      return;
    }

    if (typename === 'Metafield') {
      this.countersMutable.metafieldsSeen += 1;
      const id = extractId(line);
      if (!id) {
        await this.params.onRecord({
          kind: 'quarantine_invalid_metafield',
          id: '',
          reason: 'missing_id',
          raw: obj,
        });
        this.countersMutable.metafieldsQuarantined += 1;
        return;
      }

      const owner = extractMetafieldOwner(line);
      if (!owner) {
        await this.params.onRecord({
          kind: 'quarantine_invalid_metafield',
          id,
          reason: 'missing_owner_id',
          raw: obj,
        });
        this.countersMutable.metafieldsQuarantined += 1;
        return;
      }

      const nk = extractMetafieldNamespaceKey(line);
      if (!nk) {
        await this.params.onRecord({
          kind: 'quarantine_invalid_metafield',
          id,
          reason: 'missing_namespace_key',
          raw: obj,
        });
        this.countersMutable.metafieldsQuarantined += 1;
        return;
      }

      const env: SpillMetafieldEnvelope = {
        __typename: 'Metafield',
        id,
        ownerId: owner.ownerId,
        ownerTypename: owner.ownerTypename,
        namespace: nk.namespace,
        key: nk.key,
        value: extractMetafieldValue(line),
        raw: obj,
      };

      if (this.recentParents.has(env.ownerId)) {
        await this.emitMetafieldPatch(env);
        return;
      }

      await this.spillMetafield(env);
      this.countersMutable.metafieldsSpilledToDisk += 1;
      return;
    }

    if (typename === 'InventoryLevel') {
      this.countersMutable.inventoryLevelsSeen += 1;
      const id = extractId(line);
      if (!id) {
        await this.params.onRecord({
          kind: 'quarantine_invalid_inventory_level',
          id: '',
          reason: 'missing_id',
          raw: obj,
        });
        this.countersMutable.inventoryLevelsQuarantined += 1;
        return;
      }

      const inventoryItemId = asString(line.__parentId);
      if (!inventoryItemId) {
        await this.params.onRecord({
          kind: 'quarantine_invalid_inventory_level',
          id,
          reason: 'missing_parent_id',
          raw: obj,
        });
        this.countersMutable.inventoryLevelsQuarantined += 1;
        return;
      }

      const env: SpillInventoryLevelEnvelope = {
        __typename: 'InventoryLevel',
        id,
        inventoryItemId,
        raw: obj,
      };

      if (this.recentParents.has(env.inventoryItemId)) {
        await this.emitInventoryLevel(env);
        return;
      }

      await this.spillInventoryLevel(env);
      this.countersMutable.inventoryLevelsSpilledToDisk += 1;
      return;
    }
  }

  public async finalize(): Promise<void> {
    // 1) Spill any remaining in-memory orphans to disk so we can resolve in a single pass.
    if (this.inMemoryOrphansByParentId.size > 0) {
      for (const envs of this.inMemoryOrphansByParentId.values()) {
        for (const env of envs) {
          await this.spillOrphanVariant(env);
          this.countersMutable.variantsSpilledToDisk += 1;
        }
      }
      this.inMemoryOrphansByParentId.clear();
      this.inMemoryOrphansCount = 0;
    }

    // 2) Resolve spilled orphans bucket-by-bucket (bounded memory).
    for (let bucket = 0; bucket < this.bucketCount; bucket += 1) {
      const parentIds = await this.loadParentBucket(bucket);

      await this.resolveOrphanBucketVariants(bucket, parentIds);
      await this.resolveOrphanBucketMetafields(bucket, parentIds);
      await this.resolveOrphanBucketInventoryLevels(bucket, parentIds);
    }
  }

  private async recordParentId(parentId: string): Promise<void> {
    this.recentParents.set(parentId, true);
    this.recentParentsOrder.push(parentId);
    if (this.recentParentsOrder.length > this.maxInMemoryParents) {
      const evict = this.recentParentsOrder.splice(
        0,
        this.recentParentsOrder.length - this.maxInMemoryParents
      );
      for (const id of evict) this.recentParents.delete(id);
    }

    const bucket = hashToBucket(parentId, this.bucketCount);
    const parentsPath = this.parentBucketPath(bucket);
    await appendLine(parentsPath, parentId);
  }

  private async emitVariant(env: SpillVariantEnvelope): Promise<void> {
    await this.params.onRecord({
      kind: 'variant',
      id: env.id,
      productId: env.parentId,
      raw: env.raw,
    });
    this.countersMutable.variantsEmitted += 1;
  }

  private async emitMetafieldPatch(env: SpillMetafieldEnvelope): Promise<void> {
    const patch = {
      [env.namespace]: {
        [env.key]: env.value,
      },
    } as const;

    const kind =
      env.ownerTypename === 'ProductVariant'
        ? ('variant_metafields_patch' as const)
        : ('product_metafields_patch' as const);
    await this.params.onRecord({
      kind,
      ownerId: env.ownerId,
      namespace: env.namespace,
      key: env.key,
      value: env.value,
      patch,
      raw: env.raw,
    });
    this.countersMutable.metafieldsEmitted += 1;
  }

  private async emitInventoryLevel(env: SpillInventoryLevelEnvelope): Promise<void> {
    await this.params.onRecord({
      kind: 'inventory_level',
      id: env.id,
      inventoryItemId: env.inventoryItemId,
      raw: env.raw,
    });
    this.countersMutable.inventoryLevelsEmitted += 1;
  }

  private orphanBucketPath(
    kind: 'variant' | 'metafield' | 'inventory_level',
    bucket: number
  ): string {
    return path.join(this.orphansDir, `orphans.${kind}.${String(bucket).padStart(4, '0')}.jsonl`);
  }

  private parentBucketPath(bucket: number): string {
    return path.join(this.parentsDir, `parents.${String(bucket).padStart(4, '0')}.txt`);
  }

  private async spillOrphanVariant(env: SpillVariantEnvelope): Promise<void> {
    const bucket = hashToBucket(env.parentId, this.bucketCount);
    const orphanPath = this.orphanBucketPath('variant', bucket);
    await appendLine(orphanPath, JSON.stringify(env));
  }

  private async spillMetafield(env: SpillMetafieldEnvelope): Promise<void> {
    const bucket = hashToBucket(env.ownerId, this.bucketCount);
    const orphanPath = this.orphanBucketPath('metafield', bucket);
    await appendLine(orphanPath, JSON.stringify(env));
  }

  private async spillInventoryLevel(env: SpillInventoryLevelEnvelope): Promise<void> {
    const bucket = hashToBucket(env.inventoryItemId, this.bucketCount);
    const orphanPath = this.orphanBucketPath('inventory_level', bucket);
    await appendLine(orphanPath, JSON.stringify(env));
  }

  private async loadParentBucket(bucket: number): Promise<Set<string>> {
    const parentsPath = this.parentBucketPath(bucket);
    const set = new Set<string>();
    const ok = await fileExists(parentsPath);
    if (!ok) return set;

    const rl = readline.createInterface({
      input: createReadStream(parentsPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const rawLine of rl) {
      const id = rawLine.trim();
      if (id) set.add(id);
    }
    return set;
  }

  private async quarantineOrphanVariant(env: SpillVariantEnvelope): Promise<void> {
    const quarantinePath = path.join(
      this.quarantineDir,
      `orphan-variants.${this.params.shopId}.jsonl`
    );
    await appendLine(quarantinePath, JSON.stringify(env));

    this.params.logger.warn(
      {
        [OTEL_ATTR.SHOP_ID]: this.params.shopId,
        variantId: env.id,
        parentId: env.parentId,
      },
      'Orphan variant quarantined (missing parent Product in JSONL)'
    );

    await this.params.onRecord({
      kind: 'quarantine_orphan_variant',
      id: env.id,
      missingParentId: env.parentId,
      raw: env.raw,
    });
  }

  private async quarantineOrphanMetafield(env: SpillMetafieldEnvelope): Promise<void> {
    const quarantinePath = path.join(
      this.quarantineDir,
      `orphan-metafields.${this.params.shopId}.jsonl`
    );
    await appendLine(quarantinePath, JSON.stringify(env));

    this.params.logger.warn(
      {
        [OTEL_ATTR.SHOP_ID]: this.params.shopId,
        metafieldId: env.id,
        ownerId: env.ownerId,
      },
      'Orphan metafield quarantined (missing owner in JSONL)'
    );

    await this.params.onRecord({
      kind: 'quarantine_orphan_metafield',
      id: env.id,
      missingParentId: env.ownerId,
      raw: env.raw,
    });
  }

  private async quarantineOrphanInventoryLevel(env: SpillInventoryLevelEnvelope): Promise<void> {
    const quarantinePath = path.join(
      this.quarantineDir,
      `orphan-inventory-levels.${this.params.shopId}.jsonl`
    );
    await appendLine(quarantinePath, JSON.stringify(env));

    this.params.logger.warn(
      {
        [OTEL_ATTR.SHOP_ID]: this.params.shopId,
        inventoryLevelId: env.id,
        inventoryItemId: env.inventoryItemId,
      },
      'Orphan inventory level quarantined (missing InventoryItem in JSONL)'
    );

    await this.params.onRecord({
      kind: 'quarantine_orphan_inventory_level',
      id: env.id,
      missingParentId: env.inventoryItemId,
      raw: env.raw,
    });
  }

  private async resolveOrphanBucketVariants(
    bucket: number,
    parentIds: ReadonlySet<string>
  ): Promise<void> {
    const orphanPath = this.orphanBucketPath('variant', bucket);
    const has = await fileExists(orphanPath);
    if (!has) return;

    const rl = readline.createInterface({
      input: createReadStream(orphanPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;
      let env: SpillVariantEnvelope;
      try {
        env = JSON.parse(line) as SpillVariantEnvelope;
      } catch {
        continue;
      }
      if (env?.__typename !== 'ProductVariant') continue;

      if (parentIds.has(env.parentId)) {
        await this.emitVariant(env);
      } else {
        await this.quarantineOrphanVariant(env);
        this.countersMutable.variantsQuarantined += 1;
      }
    }
  }

  private async resolveOrphanBucketMetafields(
    bucket: number,
    parentIds: ReadonlySet<string>
  ): Promise<void> {
    const orphanPath = this.orphanBucketPath('metafield', bucket);
    const has = await fileExists(orphanPath);
    if (!has) return;

    const rl = readline.createInterface({
      input: createReadStream(orphanPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;
      let env: SpillMetafieldEnvelope;
      try {
        env = JSON.parse(line) as SpillMetafieldEnvelope;
      } catch {
        continue;
      }
      if (env?.__typename !== 'Metafield') continue;

      if (parentIds.has(env.ownerId)) {
        await this.emitMetafieldPatch(env);
      } else {
        await this.quarantineOrphanMetafield(env);
        this.countersMutable.metafieldsQuarantined += 1;
      }
    }
  }

  private async resolveOrphanBucketInventoryLevels(
    bucket: number,
    parentIds: ReadonlySet<string>
  ): Promise<void> {
    const orphanPath = this.orphanBucketPath('inventory_level', bucket);
    const has = await fileExists(orphanPath);
    if (!has) return;

    const rl = readline.createInterface({
      input: createReadStream(orphanPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;
      let env: SpillInventoryLevelEnvelope;
      try {
        env = JSON.parse(line) as SpillInventoryLevelEnvelope;
      } catch {
        continue;
      }
      if (env?.__typename !== 'InventoryLevel') continue;

      if (parentIds.has(env.inventoryItemId)) {
        await this.emitInventoryLevel(env);
      } else {
        await this.quarantineOrphanInventoryLevel(env);
        this.countersMutable.inventoryLevelsQuarantined += 1;
      }
    }
  }
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const s = createWriteStream(filePath, { encoding: 'utf8', flags: 'a' });
    s.on('error', reject);
    s.end(`${line}\n`, () => resolve());
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// COPY-friendly row shapes (used by PR-042).
// Kept here to ensure PR-041 defines stable transform outputs.
export type StagingProductRowShape = Readonly<{
  shopify_gid: string;
  title: string | null;
  handle: string | null;
  vendor: string | null;
  product_type: string | null;
  status: string | null;
  tags: readonly string[];
  raw_data: MinimalBulkJsonlObject;
}>;

export type StagingVariantRowShape = Readonly<{
  shopify_gid: string;
  product_shopify_gid: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compare_at_price: string | null;
  inventory_quantity: number | null;
  inventory_item_id: string | null;
  selected_options: unknown;
  raw_data: MinimalBulkJsonlObject;
}>;

export function toStagingProductRowShape(
  product: MinimalBulkJsonlObject
): StagingProductRowShape | null {
  const o = product as Record<string, unknown>;
  const id = asString(o['id']);
  if (!id) return null;
  return {
    shopify_gid: id,
    title: asString(o['title']),
    handle: asString(o['handle']),
    vendor: asString(o['vendor']),
    product_type: asString(o['productType']),
    status: asString(o['status']),
    tags: Array.isArray(o['tags'])
      ? (o['tags'] as unknown[]).filter((t) => typeof t === 'string')
      : [],
    raw_data: product,
  };
}

export function toStagingVariantRowShape(
  variant: MinimalBulkJsonlObject
): StagingVariantRowShape | null {
  const o = variant as Record<string, unknown>;
  const id = asString(o['id']);
  if (!id) return null;

  const parent = extractVariantParentId(o as JsonlLine);
  if (!parent) return null;

  const inventoryItem = o['inventoryItem'];
  const inventoryItemId =
    inventoryItem && typeof inventoryItem === 'object'
      ? asString((inventoryItem as Record<string, unknown>)['id'])
      : null;

  return {
    shopify_gid: id,
    product_shopify_gid: parent,
    title: asString(o['title']),
    sku: asString(o['sku']),
    barcode: asString(o['barcode']),
    price: asString(o['price']),
    compare_at_price: asString(o['compareAtPrice']),
    inventory_quantity: typeof o['inventoryQuantity'] === 'number' ? o['inventoryQuantity'] : null,
    inventory_item_id: inventoryItemId,
    selected_options: o['selectedOptions'] ?? null,
    raw_data: variant,
  };
}
