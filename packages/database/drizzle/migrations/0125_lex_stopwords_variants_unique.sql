-- Migration: 0125_lex_stopwords_variants_unique.sql
-- Purpose: D11/D12 — UNIQUE constraints for stopwords (shop + global) and term variants (Drizzle sync).

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_stopwords_shop_locale_word_unique
  ON lex_stopwords(shop_id, locale, word)
  WHERE shop_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_stopwords_global_locale_word_unique
  ON lex_stopwords(locale, word)
  WHERE shop_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_term_variants_term_norm_locale_unique
  ON lex_term_variants(term_id, normalized_variant, locale);
