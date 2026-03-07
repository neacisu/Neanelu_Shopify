DROP FUNCTION IF EXISTS find_similar_products(vector(2000), float, int);

CREATE OR REPLACE FUNCTION find_similar_products(
    query_embedding vector(2000),
    similarity_threshold float DEFAULT 0.95,
    max_results int DEFAULT 10,
    p_model_version varchar DEFAULT NULL
)
RETURNS TABLE (
    product_id uuid,
    variant_id uuid,
    embedding_type varchar(50),
    quality_level varchar(20),
    similarity float
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.product_id,
        e.variant_id,
        e.embedding_type,
        e.quality_level,
        (1 - (e.embedding <=> query_embedding))::float as similarity
    FROM prod_embeddings e
    WHERE e.embedding_type = 'combined'
      AND (p_model_version IS NULL OR e.model_version = p_model_version)
      AND (e.embedding <=> query_embedding) < (1 - similarity_threshold)
    ORDER BY e.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_similar_products(vector(2000), float, int, varchar) IS
    'Find similar products with optional model_version filter to avoid cross-model vector comparisons';
