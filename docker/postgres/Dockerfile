# ============================================
# PostgreSQL 18.1 + pgvector 0.8.1 (Official Image)
# ============================================
# Versiuni confirmate la 29 decembrie 2025:
# - PostgreSQL: 18.1 (Debian 18.1-1.pgdg12+2)
# - pgvector: 0.8.1
#
# Imaginea oficială pgvector include PostgreSQL + pgvector precompilat
# DockerHub: https://hub.docker.com/r/pgvector/pgvector
# GitHub: https://github.com/pgvector/pgvector
# ============================================

# Tag explicit cu versiune pentru reproducibilitate
FROM pgvector/pgvector:0.8.1-pg18

LABEL maintainer="neacsu.alex@gmail.com"
LABEL description="PostgreSQL 18.1 with pgvector 0.8.1 for Neanelu Shopify"
LABEL postgres.version="18.1"
LABEL pgvector.version="0.8.1"
LABEL build.date="2025-12-29"

# ============================================
# EXTENSII INCLUSE
# ============================================
# PostgreSQL 18.1 include nativ:
# - pgcrypto 1.4
# - citext 1.8
# - pg_trgm 1.6
# - btree_gin 1.3
# - btree_gist 1.8
# - pg_stat_statements 1.12
# - uuidv7() function (nativ în PG18, fără extensie)
#
# pgvector 0.8.1 features:
# - HNSW index pentru căutare vectorială rapidă
# - Cosine, L2, Inner Product distance metrics
# - Suport pentru milioane de vectori cu latency <10ms

# ============================================
# CONFIGURARE
# ============================================

# Extensiile vor fi create manual prin migrații SQL (0000_enable_extensions.sql)
# pgvector nu necesită shared_preload_libraries

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-postgres} || exit 1
