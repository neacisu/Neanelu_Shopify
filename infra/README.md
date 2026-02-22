# Infra (Neanelu Shopify) - FAZA 0+

Acest director contine configuratii si scripturi **versionate** pentru migrarea Neanelu pe infrastructura noua
(LXC prod+staging + shared services pe orchestrator/CT107), aliniat cu pattern-urile Cerniq.

Principii:

- Orice schimbare pe shared infra este strict **aditiva** (fisiere Traefik dedicate, reguli iptables dedicate, mounts/policies OpenBao dedicate).
- Secretele nu stau in repo; sunt gestionate in OpenBao (KV v1) si/sau GitHub Secrets (FAZA 1).
- Scripturile care folosesc Python ruleaza exclusiv cu `python3`.

Structura (in curs de completare):

- `infra/config/iptables/` - template-uri reguli hz.247 (egress/inbound) dedicate Neanelu
- `infra/config/postgres/` - init scripts pentru CT107 (DB + extensii + roluri)
- `infra/config/openbao/` - agent configs + templates (env, pgbouncer)
- `infra/config/traefik-orchestrator/` - file-provider dedicat `neanelu.yml`
- `infra/scripts/` - scripturi idempotente / helper pentru apply/verify
