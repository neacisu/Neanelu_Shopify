# Production Deployment Checklist - NEANELU Shopify Manager

> **Versiune:** 1.0 | **Data:** 2025-12-26

---

## Pre-Deployment (T-24h)

### Code Freeze

- [ ] Feature freeze aplicat pe branch `main`
- [ ] Toate PR-urile pentru release merged
- [ ] CHANGELOG.md actualizat cu versiunea nouă
- [ ] Tag-ul Git creat: `v{major}.{minor}.{patch}`

### Infrastructure Verification

- [ ] Bare metal server accessible via SSH
- [ ] Docker version >= 27.0 instalat
- [ ] Sufficient disk space (>50GB free)
- [ ] Network connectivity to Shopify API verified

### Secrets Verification

- [ ] OpenBAO unsealed și accesibil
- [ ] Shopify API credentials valid (test cu API call)
- [ ] BullMQ Pro token valid
- [ ] OpenAI API key valid și cu credit suficient
- [ ] Database credentials configured

---

## Pre-Deployment (T-2h)

### Database Preparation

- [ ] Backup complet creat: `pg_dump -Fc neanelu_shopify_prod > backup_$(date +%Y%m%d).dump`
- [ ] Backup verification: restore test pe staging
- [ ] Migration dry-run executat pe staging
- [ ] RLS policies verified pe staging

### Container Build

- [ ] Docker images built successfully
- [ ] Image vulnerability scan (Trivy) passed
- [ ] Image pushed to registry
- [ ] Image tags match release version

---

## Deployment (T-0)

### Notification

- [ ] Team notified via Slack: `@channel Production deployment starting`
- [ ] Status page updated (if applicable)

### Database Migration

```bash
# 1. Verifică migration pending
pnpm db:migrate:status

# 2. Backup final
docker compose exec db pg_dump -U shopify -Fc neanelu_shopify_prod > /backups/pre_deploy_$(date +%Y%m%d_%H%M).dump

# 3. Run migration
pnpm db:migrate:prod

# 4. Verify RLS policies
docker compose exec db psql -U shopify -d neanelu_shopify_prod -c "SELECT tablename, policyname FROM pg_policies;"
```

### Application Deployment

```bash
# 1. Pull new images
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull

# 2. Graceful stop (finish in-progress jobs)
docker compose exec backend-worker node scripts/graceful-shutdown.js

# 3. Deploy with zero-downtime
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans

# 4. Verify containers running
docker compose ps
```

### Health Verification

- [ ] `/health/ready` returns 200
- [ ] `/health/live` returns 200
- [ ] Database connection verified
- [ ] Redis connection verified
- [ ] BullMQ workers active

---

## Post-Deployment (T+15m)

### Smoke Tests

```bash
# 1. OAuth flow test
curl -I "https://api.neanelu.shop/auth/shopify?shop=test-store.myshopify.com"

# 2. Webhook endpoint test
curl -X POST "https://api.neanelu.shop/webhooks/products/update" \
  -H "X-Shopify-Topic: products/update" \
  -H "X-Shopify-Hmac-Sha256: test" \
  -d '{}'

# 3. API response test
curl "https://api.neanelu.shop/health/ready"

# 4. Queue status
curl "https://api.neanelu.shop/api/queues" -H "Authorization: Bearer $TOKEN"
```

### Monitoring Verification

- [ ] Grafana dashboards showing data
- [ ] Error rate < 0.1%
- [ ] Latency p99 < 500ms
- [ ] No critical alerts firing

### Functional Verification

- [ ] Embedded app loads in Shopify Admin
- [ ] Product sync working
- [ ] Bulk operations can be started
- [ ] AI search returns results

---

## Rollback Procedure

### Immediate Rollback (< 5 minutes)

```bash
# 1. Revert to previous image
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --pull never

# 2. Rollback database (if needed)
docker compose exec db pg_restore -U shopify -d neanelu_shopify_prod /backups/pre_deploy_YYYYMMDD_HHMM.dump
```

### Post-Rollback

- [ ] Verify application health
- [ ] Notify team of rollback
- [ ] Create incident ticket
- [ ] Schedule post-mortem

---

## Post-Deployment (T+24h)

### Monitoring Review

- [ ] Error rates stable
- [ ] No memory leaks detected
- [ ] Queue processing normal
- [ ] API latency acceptable

### Documentation Update

- [ ] Update deployment log
- [ ] Note any issues encountered
- [ ] Update runbooks if needed

### Cleanup

- [ ] Remove old Docker images: `docker image prune -a --filter "until=168h"`
- [ ] Archive old backups (keep last 7)
- [ ] Close deployment ticket

---

## Emergency Contacts

| Role              | Contact                | Availability.  |
| ----------------- | ---------------------- | -------------- |
| On-Call Engineer  | TODO Q1 2026           | 24/7           |
| Database Admin    | TODO Q1 2026           | Business hours |
| Shopify Support   | <partners@shopify.com> | Business hours |

---

## Deployment Log

| Date       | Version | Deployer | Status | Notes                         |
| ---------- | ------- | -------- | ------ | ----------------------------- |
| YYYY-MM-DD | v1.0.0  | Name     | ✅     | Initial production deployment |
