-- Migration: 0071_add_total_inventory_to_products.sql
-- Purpose: Add missing total_inventory column to shopify_products table
-- Fix for: column "total_inventory" of relation "shopify_products" does not exist

ALTER TABLE shopify_products
  ADD COLUMN IF NOT EXISTS total_inventory INTEGER;

COMMENT ON COLUMN shopify_products.total_inventory IS 'Total inventory quantity across all variants';
