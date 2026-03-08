-- Migration: 0107_collections_description_en.sql
-- Add description_en column for translated collection descriptions (RO→EN)
-- Used as context for improved AI taxonomy assignment, menu categorization, and embeddings

ALTER TABLE shopify_collections
  ADD COLUMN IF NOT EXISTS description_en TEXT;
