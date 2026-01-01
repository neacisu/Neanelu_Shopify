-- Migration: 0041_create_helper_functions.sql
-- Epic 3: SQL Helper Functions

-- ============================================
-- Function 1: Find Similar Products (Vector Search)
-- ============================================

CREATE OR REPLACE FUNCTION find_similar_products(
  query_embedding vector(1536),
  similarity_threshold float DEFAULT 0.95,
  max_results int DEFAULT 10
)
RETURNS TABLE (
  product_id uuid, 
  similarity float,
  title text,
  brand text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.product_id, 
    (1 - (e.embedding <=> query_embedding))::float as similarity,
    pm.canonical_title as title,
    pm.brand
  FROM prod_embeddings e
  JOIN prod_master pm ON pm.id = e.product_id
  WHERE e.embedding_type = 'title_brand'
    AND (1 - (e.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_similar_products IS 'Find semantically similar products using pgvector HNSW index. Use for deduplication.';

-- ============================================
-- Function 2: Audit Critical Action Trigger
-- ============================================

CREATE OR REPLACE FUNCTION audit_critical_action()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    shop_id, 
    action, 
    actor_type, 
    resource_type, 
    resource_id, 
    details, 
    trace_id
  )
  VALUES (
    COALESCE(NEW.shop_id, OLD.shop_id), 
    TG_ARGV[0]::text, 
    'system'::text, 
    TG_TABLE_NAME::text,
    COALESCE(NEW.id, OLD.id),
    jsonb_build_object(
      'operation', TG_OP, 
      'old_data', CASE WHEN TG_OP IN ('DELETE', 'UPDATE') THEN to_jsonb(OLD) ELSE NULL END,
      'new_data', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
      'changed_at', NOW()
    ),
    current_setting('app.trace_id', true)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit_critical_action IS 'Trigger function for automatic audit logging. Usage: CREATE TRIGGER ... AFTER INSERT OR UPDATE OR DELETE ... EXECUTE FUNCTION audit_critical_action(''action_name'')';

-- ============================================
-- Function 3: Calculate PIM Quality Score
-- ============================================

CREATE OR REPLACE FUNCTION calculate_pim_quality_score(
  p_product_id uuid
)
RETURNS TABLE (
  quality_score int,
  quality_level text,
  missing_fields text[]
) AS $$
DECLARE
  v_score int := 0;
  v_missing text[] := ARRAY[]::text[];
  v_product prod_master%ROWTYPE;
  v_specs jsonb;
  v_has_embedding boolean;
BEGIN
  -- Get product data
  SELECT * INTO v_product FROM prod_master WHERE id = p_product_id;
  
  IF v_product.id IS NULL THEN
    RETURN QUERY SELECT 0, 'NOT_FOUND'::text, ARRAY['product_not_found']::text[];
    RETURN;
  END IF;
  
  -- Get specs
  SELECT specs INTO v_specs 
  FROM prod_specs_normalized 
  WHERE product_id = p_product_id 
  ORDER BY version DESC LIMIT 1;
  
  -- Check embedding
  SELECT EXISTS(SELECT 1 FROM prod_embeddings WHERE product_id = p_product_id) INTO v_has_embedding;
  
  -- Title (20 points)
  IF v_product.canonical_title IS NOT NULL AND LENGTH(v_product.canonical_title) > 5 THEN
    v_score := v_score + 20;
  ELSE
    v_missing := array_append(v_missing, 'canonical_title');
  END IF;
  
  -- Brand (15 points)
  IF v_product.brand IS NOT NULL AND LENGTH(v_product.brand) > 0 THEN
    v_score := v_score + 15;
  ELSE
    v_missing := array_append(v_missing, 'brand');
  END IF;
  
  -- Taxonomy (15 points)
  IF v_product.taxonomy_id IS NOT NULL THEN
    v_score := v_score + 15;
  ELSE
    v_missing := array_append(v_missing, 'taxonomy_id');
  END IF;
  
  -- Specs (30 points max)
  IF v_specs IS NOT NULL THEN
    IF jsonb_typeof(v_specs) = 'object' AND (SELECT COUNT(*) FROM jsonb_object_keys(v_specs)) >= 5 THEN
      v_score := v_score + 30;
    ELSIF jsonb_typeof(v_specs) = 'object' AND (SELECT COUNT(*) FROM jsonb_object_keys(v_specs)) >= 2 THEN
      v_score := v_score + 15;
      v_missing := array_append(v_missing, 'specs_incomplete');
    ELSE
      v_score := v_score + 5;
      v_missing := array_append(v_missing, 'specs_minimal');
    END IF;
  ELSE
    v_missing := array_append(v_missing, 'specs');
  END IF;
  
  -- Embedding (10 points)
  IF v_has_embedding THEN
    v_score := v_score + 10;
  ELSE
    v_missing := array_append(v_missing, 'embedding');
  END IF;
  
  -- Internal SKU (10 points)
  IF v_product.internal_sku IS NOT NULL THEN
    v_score := v_score + 10;
  ELSE
    v_missing := array_append(v_missing, 'internal_sku');
  END IF;
  
  -- Determine quality level
  RETURN QUERY SELECT 
    v_score,
    CASE 
      WHEN v_score >= 80 THEN 'GOLDEN'
      WHEN v_score >= 50 THEN 'SILVER'
      ELSE 'BRONZE'
    END::text,
    v_missing;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_pim_quality_score IS 'Calculate quality score for a PIM product. Returns score (0-100), level (BRONZE/SILVER/GOLDEN), and missing fields.';

-- ============================================
-- Function 4: Batch Update Quality Scores
-- ============================================

CREATE OR REPLACE FUNCTION batch_update_quality_scores(
  p_limit int DEFAULT 1000
)
RETURNS TABLE (
  updated_count int,
  bronze_count int,
  silver_count int,
  golden_count int
) AS $$
DECLARE
  v_updated int := 0;
  v_bronze int := 0;
  v_silver int := 0;
  v_golden int := 0;
  v_product RECORD;
  v_result RECORD;
BEGIN
  FOR v_product IN 
    SELECT id FROM prod_master 
    WHERE quality_score IS NULL OR updated_at > NOW() - INTERVAL '1 day'
    ORDER BY updated_at DESC
    LIMIT p_limit
  LOOP
    SELECT * INTO v_result FROM calculate_pim_quality_score(v_product.id);
    
    UPDATE prod_master SET 
      quality_score = v_result.quality_score,
      data_quality_level = v_result.quality_level,
      updated_at = NOW()
    WHERE id = v_product.id;
    
    v_updated := v_updated + 1;
    
    CASE v_result.quality_level
      WHEN 'BRONZE' THEN v_bronze := v_bronze + 1;
      WHEN 'SILVER' THEN v_silver := v_silver + 1;
      WHEN 'GOLDEN' THEN v_golden := v_golden + 1;
      ELSE NULL;
    END CASE;
  END LOOP;
  
  RETURN QUERY SELECT v_updated, v_bronze, v_silver, v_golden;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION batch_update_quality_scores IS 'Batch update quality scores for products. Default limit 1000 products per call.';
