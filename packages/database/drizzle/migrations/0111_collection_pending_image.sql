ALTER TABLE shopify_collections
  ADD COLUMN IF NOT EXISTS pending_image_path TEXT;
