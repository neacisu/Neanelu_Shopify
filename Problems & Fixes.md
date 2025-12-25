## Audit observabilitate, logging și debugging (planificare)

### Constatări

- Planul acoperă bine traseul de observabilitate pe backend (HTTP/webhooks în [Plan_de_implementare.md#L1200-L1340](Plan_de_implementare.md#L1200-L1340), cozi în [Plan_de_implementare.md#L1800-L1930](Plan_de_implementare.md#L1800-L1930), ingestie în [Plan_de_implementare.md#L2200-L2330](Plan_de_implementare.md#L2200-L2330), prod în [Plan_de_implementare.md#L2830-L2960](Plan_de_implementare.md#L2830-L2960)), dar nu există un standard unic de log schema/fields și redaction pentru toate serviciile; redacția PII apare abia în faza F7.1.2.
- Nu este specificată destinația/stack-ul pentru colectarea logurilor (OTLP logs vs. syslog/ELK), nici retenția și politicile de rotație; apare doar colectorul OTel în [Plan_de_implementare.md#L2830-L2960](Plan_de_implementare.md#L2830-L2960).
- Lipsesc cerințe de audit trail pentru acțiuni sensibile (login OAuth, schimbare secrete, rulare bulk), astfel încât în producție nu există garanții de non-repudiere.
- Frontend-ul are doar o componentă `LogConsole` definită în [Docs/Frontend_Component_Specs.md#L180-L240](Docs/Frontend_Component_Specs.md#L180-L240) și log view în F5.5.3, dar nu există specificație pentru sursa/transportul logurilor (SSE/WebSocket/polling), filtru pe shop sau corelare traceId → UI.
- Observabilitatea DB/Redis e menționată sumar în dashboard-urile F7.1.3, fără cerințe pentru loguri de query lent, explain plan sampling sau alerte pe pool saturation; niciun runbook/document nu este referit explicit.
- Nu există ghid de debugging local/CI (cum se pornește OTel în dev, cum se investighează o cursă de rate-limit sau un job stuck), deși există teste/chaos în F5.4.

### Recomandări (doar documentație)

1. **Standard log schema + redaction**: Adaugă în [Plan_de_implementare.md](Plan_de_implementare.md) o secțiune transversală (F3.1/F3.4) cu schema de log JSON (campuri obligatorii: `timestamp`, `level`, `message`, `service.name`, `env`, `requestId`, `traceId`, `spanId`, `shopId`, `jobId` opțional, `error.code`, `error.stack` redacted) și reguli de redaction (no PII, no tokens) aplicabile tuturor serviciilor.
2. **Stack log shipping & retenție**: Documentează în F7.1.1 destinatia pentru loguri (ex. OTel collector → Loki/ELK), retenția (ex. 7 zile hot, 30 zile warm), rotație și limite de volum; include cerință de backpressure/fallback (drop sau sample) când colectorul e căzut.
3. **Audit trail operațional**: Introdu în F3.2/F5/F7 cerințe pentru evenimente de audit (login OAuth, schimbare scopes, lansare/abort bulk, schimbare setări rate-limit) persistate în tabela `audit_logs` (RLS-aware), cu corelare traceId și user/shop; menționează și în [Docs/DevOps_Plan_Implementare_Shopify_Enterprise.md](Docs/DevOps_Plan_Implementare_Shopify_Enterprise.md) la secțiunea de securitate.
4. **Frontend logging pipeline**: Completează F5.5.3-5.5.4 cu specificație de transport (SSE preferat, fallback polling), filtru `shopId`, mapare `traceId` din răspuns backend → UI pentru navigare spre Jaeger, plus limite `maxLines`/rate pentru a evita overload UI.
5. **DB/Redis observability**: Extinde F7.1.3 cu cerințe de slow query log (threshold documentat), sampling EXPLAIN pentru top N query-uri, alerte pe pool saturation și replication lag (dacă apare), plus logare a parametrilor sensibili redacționați. Menționează și log-level recomandat pentru Redis (SLOWLOG export).
6. **Runbooks și ghid de debugging**: Adaugă în F7.1.4 referințe către runbooks (ex. `Docs/runbooks/*.md`) pentru scenarii: 429 storm, rate-limit lock contention, job stuck, collector OTel căzut, Postgres în `read-only` din cauza failover; descrie pașii de diagnostic + comenzi.
7. **CI/dev debugging toggle**: Notează în F3.4/F4.4 că în dev/CI OTel sampling=100% și loglevel=debug, cu flag de environment (`OBS_DEBUG=1`) documentat; în prod sampling adaptiv ≤10% și loglevel info.

### Implementare propusă (doar modificări de documentație)

- Actualizează [Plan_de_implementare.md](Plan_de_implementare.md) în fazele F3.4, F5.3, F7.1 cu itemii 1–7 de mai sus.
- Adaugă o secțiune „Audit & Observability Standard” în [Docs/DevOps_Plan_Implementare_Shopify_Enterprise.md](Docs/DevOps_Plan_Implementare_Shopify_Enterprise.md) care să repete schema de log, redaction, retenție și audit trail.
- Extinde [Docs/Frontend_Component_Specs.md](Docs/Frontend_Component_Specs.md) cu detalii de transport pentru `LogConsole` și corelare traceId.
