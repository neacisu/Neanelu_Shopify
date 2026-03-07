SELECT model_version, COUNT(*)
FROM prod_embeddings
WHERE embedding IS NOT NULL
GROUP BY model_version
ORDER BY COUNT(*) DESC;

SELECT model_version, COUNT(*)
FROM shop_product_embeddings
WHERE embedding IS NOT NULL
GROUP BY model_version
ORDER BY COUNT(*) DESC;
