export function normalizeShopIdToGroupId(shopId: string): string | null {
  const normalized = shopId.trim().toLowerCase();
  if (!normalized) return null;

  // Canonical UUID format (lowercase hex). We enforce canonicalization here so:
  // - group.id is stable
  // - job.data.shopId matches the group id
  // - we avoid accidental cardinality drift (e.g., casing/whitespace)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    return null;
  }

  return normalized;
}
