SELECT COUNT(*) AS total_active
FROM prod_taxonomy
WHERE is_active = TRUE;

SELECT COUNT(*) AS with_embedding
FROM prod_taxonomy
WHERE is_active = TRUE
  AND embedding IS NOT NULL;

SELECT model_version, COUNT(*)
FROM prod_taxonomy
WHERE is_active = TRUE
  AND embedding IS NOT NULL
GROUP BY model_version
ORDER BY COUNT(*) DESC;
