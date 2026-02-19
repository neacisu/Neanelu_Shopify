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
- `approle/neanelu-prod-workers`
- `approle/neanelu-staging-api`
- `approle/neanelu-staging-workers`
- `approle/neanelu-infra` (optional: pentru sidecar/agent configs)
- `approle/neanelu-cicd` (FAZA 1)

## Policies (fisiere)

Vezi `infra/config/openbao/policies/`:

- `neanelu-prod-api.hcl`
- `neanelu-prod-workers.hcl`
- `neanelu-staging-api.hcl`
- `neanelu-staging-workers.hcl`
- `neanelu-infra.hcl`

## Apply

Aplicarea efectiva necesita un token de administrare OpenBao (nu se tine in repo).

Script: `infra/scripts/orchestrator_openbao_apply_neanelu.sh`

Variabile necesare:

- `BAO_ADDR` (ex: `http://127.0.0.1:8200` pe orchestrator, sau `https://s3cr3ts.neanelu.ro` prin Traefik)
- `BAO_TOKEN` (token admin temporar pentru bootstrap)
