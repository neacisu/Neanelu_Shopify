DROP FUNCTION IF EXISTS find_similar_shop_products(uuid, vector(2000), float, int);

CREATE OR REPLACE FUNCTION find_similar_shop_products(
    p_shop_id uuid,
    query_embedding vector(2000),
    similarity_threshold float DEFAULT 0.9,
    max_results int DEFAULT 20,
    p_model_version varchar DEFAULT NULL
)
RETURNS TABLE (
    product_id uuid,
    embedding_type varchar(50),
    quality_level varchar(20),
    similarity float
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.product_id,
        e.embedding_type,
        e.quality_level,
        (1 - (e.embedding <=> query_embedding))::float as similarity
    FROM shop_product_embeddings e
    WHERE e.shop_id = p_shop_id
      AND e.status = 'ready'
      AND (p_model_version IS NULL OR e.model_version = p_model_version)
      AND (e.embedding <=> query_embedding) < (1 - similarity_threshold)
    ORDER BY e.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_similar_shop_products(uuid, vector(2000), float, int, varchar) IS
    'Find similar shop products with optional model_version filter to avoid cross-model vector comparisons';
