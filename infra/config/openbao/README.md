# OpenBao (orchestrator) - Neanelu

Scop: definim artefacte reproducibile (policies + AppRole names + paths KV v1) pentru Neanelu, aliniat cu pattern-ul platformei Cerniq.

Principii:

- OpenBao ruleaza centralizat pe `orchestrator` (container `openbao`).
- Folosim **KV v1** pe mount-ul `secret/` (deci paths de forma `secret/neanelu/...`, fara `/data/`).
- Schimbarile pe shared infra sunt strict **aditive**: noi policies, noi AppRoles, noi paths pentru Neanelu.
- Nu hardcodam secrete in repo. Secretele se scriu in OpenBao manual / prin CI/CD (FAZA 1).

## Paths standard (KV v1)

- `secret/neanelu/prod/*`
- `secret/neanelu/staging/*`
- `secret/neanelu/shared/*`
- `secret/neanelu/infra/*`

Recomandat: separa clar ce e per-environment (prod/staging) vs shared (ex: domenii) vs infra (PgBouncer auth_query, pgbouncer.ini, etc.).

## AppRoles (naming)

- `approle/neanelu-prod-api`
- `approle/neanelu-staging-api`
- `approle/neanelu-dev-api`
- `approle/neanelu-infra` (optional: pentru sidecar/agent configs)
- `approle/neanelu-cicd` (FAZA 1)

## Policies (fisiere)

Vezi `infra/config/openbao/policies/`:

- `neanelu-prod-api.hcl`
- `neanelu-staging-api.hcl`
- `neanelu-dev-api.hcl`
- `neanelu-infra.hcl`
- `neanelu-cicd.hcl`

## Apply

Aplicarea efectiva necesita un token de administrare OpenBao (nu se tine in repo).

Script: `infra/scripts/orchestrator_openbao_apply_neanelu.sh`

Variabile necesare:

- `BAO_ADDR` (ex: `http://127.0.0.1:8200` pe orchestrator, sau `https://s3cr3ts.neanelu.ro` prin Traefik)
- `BAO_TOKEN` (token admin temporar pentru bootstrap)

## Credential rotation (runtime)

Hot-reload-ul credentialelor este gestionat in aplicatie (`credential-watcher.ts`).
Unitatile systemd `neanelu-secrets-restart@*.path` sunt pastrate doar pentru rollback.

Dezactivare recomandata pe host-uri runtime:

- `systemctl disable --now neanelu-secrets-restart@prod.path`
- `systemctl disable --now neanelu-secrets-restart@staging.path`
- `systemctl disable --now neanelu-secrets-restart@dev.path`

## Cleanup workers AppRole-uri (manual)

Dupa rollout complet, resursele workers pot fi curate manual in OpenBao/hosturi:

- `bao delete auth/approle/role/neanelu-prod-workers`
- `bao delete auth/approle/role/neanelu-staging-workers`
- `bao delete auth/approle/role/neanelu-dev-workers`
- `rm /opt/neanelu/secrets/prod_workers_role_id /opt/neanelu/secrets/prod_workers_secret_id`
- `rm /opt/neanelu/secrets/staging_workers_role_id /opt/neanelu/secrets/staging_workers_secret_id`
- `rm /opt/neanelu/secrets/dev_workers_role_id /opt/neanelu/secrets/dev_workers_secret_id`
