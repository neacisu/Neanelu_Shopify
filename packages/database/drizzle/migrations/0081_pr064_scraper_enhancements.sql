ALTER TABLE scraper_configs
  ADD COLUMN IF NOT EXISTS max_concurrent_pages INTEGER DEFAULT 5;

ALTER TABLE scraper_runs
  ADD COLUMN IF NOT EXISTS content_hashes_deduped INTEGER DEFAULT 0;

ALTER TABLE scraper_runs
  ADD COLUMN IF NOT EXISTS method VARCHAR(20);
