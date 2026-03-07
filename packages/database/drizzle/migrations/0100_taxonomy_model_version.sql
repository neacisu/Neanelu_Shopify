ALTER TABLE prod_taxonomy
ADD COLUMN IF NOT EXISTS model_version varchar(80);

UPDATE prod_taxonomy
SET model_version = 'text-embedding-3-large'
WHERE embedding IS NOT NULL
  AND model_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_prod_taxonomy_model_version
  ON prod_taxonomy (model_version)
  WHERE is_active = true;
