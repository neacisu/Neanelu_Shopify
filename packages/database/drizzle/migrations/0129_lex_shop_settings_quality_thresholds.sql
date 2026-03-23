-- f5-01: Shop-configurable translation / localization auto-approve thresholds (defaults match prior hardcoded values).

ALTER TABLE lex_shop_settings
  ADD COLUMN IF NOT EXISTS translation_auto_approve_threshold NUMERIC(5, 4) NOT NULL DEFAULT 0.9300
    CONSTRAINT chk_lex_shop_settings_translation_auto_approve_threshold
      CHECK (translation_auto_approve_threshold >= 0 AND translation_auto_approve_threshold <= 1);

ALTER TABLE lex_shop_settings
  ADD COLUMN IF NOT EXISTS localization_auto_approve_threshold NUMERIC(5, 4) NOT NULL DEFAULT 0.8500
    CONSTRAINT chk_lex_shop_settings_localization_auto_approve_threshold
      CHECK (localization_auto_approve_threshold >= 0 AND localization_auto_approve_threshold <= 1);

COMMENT ON COLUMN lex_shop_settings.translation_auto_approve_threshold IS
  'Minimum confidence to auto-approve translation candidates / TM-backed matches (0–1); LLM outputs are capped slightly below this.';

COMMENT ON COLUMN lex_shop_settings.localization_auto_approve_threshold IS
  'Minimum weighted average replacement quality to auto-approve composed entity localizations (0–1).';
