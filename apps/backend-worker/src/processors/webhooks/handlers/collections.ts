import { withTenantContext } from '@app/database';

type CollectionWebhookPayload = Readonly<Record<string, unknown>>;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toJson(value: unknown): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

export async function handleCollectionUpsert(params: {
  shopId: string;
  payload: unknown;
}): Promise<void> {
  const body = (params.payload ?? {}) as CollectionWebhookPayload;
  const legacyId = toNumber(body['id']);
  if (!legacyId) return;

  const title = toStringOrNull(body['title']) ?? `Collection ${legacyId}`;
  const handle = toStringOrNull(body['handle']) ?? `collection-${legacyId}`;
  const descriptionHtml = toStringOrNull(body['body_html']);
  const description = toStringOrNull(body['description']) ?? descriptionHtml;
  const sortOrder = toStringOrNull(body['sort_order']);
  const rulesRaw = Array.isArray(body['rules']) ? body['rules'] : [];
  const disjunctive = Boolean(body['disjunctive'] ?? false);
  const productsCount = toNumber(body['products_count']) ?? 0;
  const templateSuffix = toStringOrNull(body['template_suffix']);
  const publishedAt = toStringOrNull(body['published_at']);
  const imageUrl =
    body['image'] && typeof body['image'] === 'object'
      ? (toStringOrNull((body['image'] as Record<string, unknown>)['src']) ??
        toStringOrNull((body['image'] as Record<string, unknown>)['url']))
      : null;

  const collectionType = rulesRaw.length > 0 ? 'SMART' : 'MANUAL';
  const shopifyGid = `gid://shopify/Collection/${legacyId}`;

  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO shopify_collections (
         shop_id,
         shopify_gid,
         legacy_resource_id,
         title,
         handle,
         description,
         description_html,
         collection_type,
         sort_order,
         rules,
         disjunctive,
         seo,
         image_url,
         products_count,
         template_suffix,
         published_at,
         synced_at,
         updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16::timestamptz, now(), now()
       )
       ON CONFLICT (shop_id, shopify_gid) DO UPDATE SET
         title = EXCLUDED.title,
         handle = EXCLUDED.handle,
         description = EXCLUDED.description,
         description_html = EXCLUDED.description_html,
         collection_type = EXCLUDED.collection_type,
         sort_order = EXCLUDED.sort_order,
         rules = EXCLUDED.rules,
         disjunctive = EXCLUDED.disjunctive,
         seo = EXCLUDED.seo,
         image_url = EXCLUDED.image_url,
         products_count = EXCLUDED.products_count,
         template_suffix = EXCLUDED.template_suffix,
         published_at = EXCLUDED.published_at,
         synced_at = now(),
         updated_at = now()`,
      [
        params.shopId,
        shopifyGid,
        legacyId,
        title,
        handle,
        description,
        descriptionHtml,
        collectionType,
        sortOrder,
        JSON.stringify(toJson(rulesRaw)),
        disjunctive,
        JSON.stringify(toJson(body['seo'])),
        imageUrl,
        productsCount,
        templateSuffix,
        publishedAt,
      ]
    );
  });
}

export async function handleCollectionDelete(params: {
  shopId: string;
  payload: unknown;
}): Promise<void> {
  const body = (params.payload ?? {}) as CollectionWebhookPayload;
  const legacyId = toNumber(body['id']);
  if (!legacyId) return;
  const shopifyGid = `gid://shopify/Collection/${legacyId}`;

  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `DELETE FROM shopify_collections
       WHERE shop_id = $1
         AND (legacy_resource_id = $2 OR shopify_gid = $3)`,
      [params.shopId, legacyId, shopifyGid]
    );
  });
}
