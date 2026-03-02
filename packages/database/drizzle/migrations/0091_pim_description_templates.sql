-- ============================================
-- Migration: 0091_pim_description_templates.sql
-- Purpose: Description templates for AI generation
-- ============================================

CREATE TABLE IF NOT EXISTS pim_description_templates (
    id                UUID PRIMARY KEY DEFAULT uuidv7(),
    shop_id           UUID REFERENCES shops(id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    locale            VARCHAR(10) DEFAULT 'ro',
    max_chars         INTEGER DEFAULT 2000,
    min_chars         INTEGER DEFAULT 200,
    required_sections TEXT[] DEFAULT ARRAY['introducere', 'caracteristici', 'utilizare'],
    tone              VARCHAR(50) DEFAULT 'professional',
    prompt_template   TEXT NOT NULL,
    is_active         BOOLEAN DEFAULT true,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

INSERT INTO pim_description_templates (shop_id, name, locale, prompt_template)
VALUES (
  NULL,
  'Standard RO',
  'ro',
  'Genereaza o descriere de produs profesionista in romana cu {{min_chars}}-{{max_chars}} caractere.
Produsul: {{title}} de la {{brand}}.
Specificatii: {{specs}}.
Structura obligatorie: {{required_sections}}.
Ton: {{tone}}. Nu inventa specificatii. Foloseste doar datele furnizate.'
)
ON CONFLICT DO NOTHING;
