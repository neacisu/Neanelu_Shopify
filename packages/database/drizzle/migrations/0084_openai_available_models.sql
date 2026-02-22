-- Migration: 0084_openai_available_models.sql
-- Purpose: Persist available OpenAI embedding models per shop (for UI dropdown).

ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS openai_available_models TEXT[];

