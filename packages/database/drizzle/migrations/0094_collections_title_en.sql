ALTER TABLE shopify_collections
  ADD COLUMN IF NOT EXISTS title_en TEXT;

COMMENT ON COLUMN shopify_collections.title_en
  IS 'English translation of the collection title, populated by LLM bulk translation for cross-lingual taxonomy matching';
